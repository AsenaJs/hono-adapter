import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { ServerLogger } from '@asenajs/asena/logger';
import { HttpMethod } from '@asenajs/asena/web-types';
import { HTTPException } from 'hono/http-exception';
import { HonoAdapter } from '../lib/HonoAdapter';

const SECRET = 'secret internal detail';

const silentLogger = (): ServerLogger => ({
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  profile: mock(() => {}),
});

/**
 * Twin of `ergenecore/test/errorLeakage.test.ts`.
 *
 * This adapter already withheld the thrown message; ergenecore echoed it. Nothing on either side
 * asserted the difference, so the divergence sat in the tree with both suites green - the same
 * shape as the 404 body divergence that started this work. Pinning it here is what stops the two
 * adapters drifting apart again, and it costs one file.
 */
describe('an unhandled error does not leak its message to the client', () => {
  let server: { stop: (force?: boolean) => void; port: number } | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  const boot = async (configure?: (adapter: HonoAdapter) => void) => {
    const adapter = new HonoAdapter(silentLogger());

    adapter.setPort(0);

    adapter.registerRoute({
      method: HttpMethod.GET,
      path: '/boom',
      middlewares: [],
      handler: () => {
        throw new Error(SECRET);
      },
      staticServe: null,
      validator: null,
    });

    adapter.registerRoute({
      method: HttpMethod.GET,
      path: '/deliberate',
      middlewares: [],
      handler: () => {
        throw new HTTPException(403, { message: 'Insufficient scope' });
      },
      staticServe: null,
      validator: null,
    });

    configure?.(adapter);

    server = (await adapter.start()) as any;

    return `http://localhost:${server!.port}`;
  };

  test('with no error handler registered', async () => {
    const baseUrl = await boot();
    const response = await fetch(`${baseUrl}/boom`);
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain(SECRET);
    expect(response.statusText).not.toContain(SECRET);
  });

  test('a deliberate HTTPException still answers its own message', async () => {
    const baseUrl = await boot();
    const response = await fetch(`${baseUrl}/deliberate`);

    // Only the unanticipated error is blanketed. A status the application chose carries the
    // message the application chose - collapsing those into a generic 500 would be the
    // opposite bug.
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('Insufficient scope');
  });

  /**
   * The fallback reached when the *application's* handler throws used to answer
   * `process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : error.message`,
   * where `error` is the ORIGINAL error rather than the handler's failure - so the message this
   * file exists to contain went straight back to the caller.
   *
   * The gate was the wrong control: the leaking branch is the one `bun run`, `bun test` and every
   * container that does not set the variable take, which made the unsafe path the default and the
   * safe path the one nobody exercised while developing. The generic string is now
   * unconditional, matching ergenecore's `respondToError`.
   */
  test('when the application handler itself throws', async () => {
    const baseUrl = await boot((adapter) =>
      adapter.onError(() => {
        throw new Error('the handler blew up too');
      }),
    );

    const response = await fetch(`${baseUrl}/boom`);
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain(SECRET);
  });

  /**
   * An `onError` handler that returns nothing is how an application says "not mine, use the
   * default", and ergenecore's `respondToError` has always honoured that. This adapter used to
   * pass the handler's return value straight to Hono, which requires a Response, so the request
   * answered
   *
   *     200 OK  "Welcome to Bun! To get started, return a Response object."
   *
   * A failed request reported to the client - and to every uptime monitor in front of it - as a
   * success carrying Bun's placeholder page. A 500 answered as 500 with a vague body is cosmetic;
   * a 500 answered as 200 is silent, which is the class of failure this release exists to remove.
   */
  test('when the application handler declines to answer', async () => {
    const baseUrl = await boot((adapter) => adapter.onError(() => undefined as any));
    const response = await fetch(`${baseUrl}/boom`);
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain(SECRET);
  });
});
