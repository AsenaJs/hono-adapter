import { afterEach, describe, expect, mock, test } from 'bun:test';
import { HonoAdapter } from '../lib/HonoAdapter';
import type { Context } from '../lib/defaults/Context';
import { HttpMethod } from '@asenajs/asena/web-types';
import type { ServerLogger } from '@asenajs/asena/logger';
import type { NotFoundRequest } from '@asenajs/asena/adapter';

const mockLogger: ServerLogger = {
  profile: mock(() => {}),
  info: mock(() => {}),
  error: mock(() => {}),
  warn: mock(() => {}),
};

/**
 * An unmatched route used to be modelled as a thrown `NotFoundError` pushed through `onError`,
 * and before that Hono's own `text/plain` 404 answered it without the application ever seeing
 * it. `onNotFound` gives routing its own hook; `onError` now only sees real throws.
 *
 * The default matters as much as the hook: with no handler at all this adapter must answer
 * exactly what ergenecore answers, which is the portability complaint that started this.
 */
describe('onNotFound', () => {
  let adapter: HonoAdapter;
  let server: any;

  const boot = async () => {
    adapter.registerRoute({
      method: HttpMethod.GET,
      path: '/known',
      middlewares: [],
      handler: async (ctx: Context) => ctx.send({ ok: true }),
    } as any);

    server = await adapter.start();

    return `http://localhost:${server.port}`;
  };

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  test('an unmatched route reaches onNotFound with a normalised path and method', async () => {
    adapter = new HonoAdapter(mockLogger);

    let seen: NotFoundRequest | undefined;

    adapter.onNotFound((context: Context, request: NotFoundRequest) => {
      seen = request;

      return context.send({ notFound: true }, 404);
    });

    const baseUrl = await boot();
    const response = await fetch(`${baseUrl}/missing/deep?q=1`, { method: 'POST' });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ notFound: true });
    // Must be identical to what ergenecore reports for the same request.
    expect(seen?.path).toBe('/missing/deep');
    expect(seen?.method).toBe('POST');
  });

  test('onError does not see an unmatched route', async () => {
    adapter = new HonoAdapter(mockLogger);

    const errorHandler = mock((_error: Error, context: Context) => context.send({ fromOnError: true }, 500));

    adapter.onError(errorHandler);
    adapter.onNotFound((context: Context) => context.send({ notFound: true }, 404));

    const baseUrl = await boot();
    const response = await fetch(`${baseUrl}/missing`);

    expect(response.status).toBe(404);
    expect(errorHandler).not.toHaveBeenCalled();
  });

  test('falls back to the shared 404 envelope when no handler is registered', async () => {
    adapter = new HonoAdapter(mockLogger);

    const baseUrl = await boot();
    const response = await fetch(`${baseUrl}/missing`);

    // Hono's own default is text/plain "404 Not Found" - this asserts we replaced it.
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: 'Not Found' });
  });

  test('the default holds even when an onError is registered', async () => {
    adapter = new HonoAdapter(mockLogger);

    adapter.onError((error: Error, context: Context) => context.send({ error: error.message }, 500));

    const baseUrl = await boot();
    const response = await fetch(`${baseUrl}/missing`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not Found' });
  });

  test('a handler that throws falls back to the default 404', async () => {
    adapter = new HonoAdapter(mockLogger);

    adapter.onNotFound(() => {
      throw new Error('handler blew up');
    });

    const baseUrl = await boot();
    const response = await fetch(`${baseUrl}/missing`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not Found' });
  });

  test('global middlewares still run before onNotFound', async () => {
    adapter = new HonoAdapter(mockLogger);

    adapter.use({
      handle: async (context: Context, next: () => Promise<void>) => {
        context.setValue('tagged', true);
        await next();
      },
      override: false,
    } as any);

    adapter.onNotFound((context: Context) => context.send({ tagged: context.getValue('tagged') === true }, 404));

    const baseUrl = await boot();
    const response = await fetch(`${baseUrl}/missing`);

    expect(await response.json()).toEqual({ tagged: true });
  });

  test('a matched route is unaffected', async () => {
    adapter = new HonoAdapter(mockLogger);

    adapter.onNotFound((context: Context) => context.send({ notFound: true }, 404));

    const baseUrl = await boot();
    const response = await fetch(`${baseUrl}/known`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
