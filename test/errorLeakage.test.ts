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

  /**
   * The async twin of the test above, and the half the original fix missed.
   *
   * The guard it introduced was `if (customResponse)`, on an un-awaited call. An async handler
   * returns a Promise, and a Promise is truthy however it resolves - so every async handler that
   * declined went straight back to answering **200** with Bun's placeholder, which is the precise
   * failure the guard was written to remove. Only the sync case was covered, so the tree stayed
   * green with the bug in it.
   *
   * Async is not the exotic case here: an `onError` that reaches a database or an audit service
   * to classify the failure is the shape the documentation recommends.
   */
  test('when an async application handler declines to answer', async () => {
    const baseUrl = await boot((adapter) => adapter.onError(async () => undefined as any));
    const response = await fetch(`${baseUrl}/boom`);
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain(SECRET);
  });

  test('when an async application handler rejects', async () => {
    // A rejection is the async form of throwing, and must land in the same branch: the framework
    // answers and records the *original* error. Before the await it escaped the try/catch as an
    // unhandled rejection instead.
    const baseUrl = await boot((adapter) =>
      adapter.onError(async () => {
        throw new Error('handler blew up');
      }),
    );
    const response = await fetch(`${baseUrl}/boom`);
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('handler blew up');
  });

  test('an async application handler that answers is still honoured', async () => {
    // The other side of the same change: `instanceof Response` must not reject a real answer.
    const baseUrl = await boot((adapter) =>
      adapter.onError(async (_error, context) => context.send({ error: 'handled' }, 503)),
    );
    const response = await fetch(`${baseUrl}/boom`);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'handled' });
  });
});
