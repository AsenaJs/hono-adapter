import { afterEach, describe, expect, mock, test } from 'bun:test';
import { HttpException } from '@asenajs/asena/adapter';
import type { ServerLogger } from '@asenajs/asena/logger';
import { HttpMethod } from '@asenajs/asena/web-types';
import type { Context } from '../lib/defaults';
import { HonoAdapter } from '../lib/HonoAdapter';
import type { HonoContextWrapper } from '../lib/HonoContextWrapper';

const silentLogger = (): ServerLogger => ({
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  profile: mock(() => {}),
});

const middleware = (handle: (context: Context) => Promise<void> | void) => ({
  handle: async (context: Context, next: () => Promise<void>) => {
    await handle(context);
    await next();
  },
  override: false,
});

const reissueSession = middleware(async (context) => {
  await context.setCookie('session', 'renewed', { extraOptions: { path: '/', httpOnly: true } });
  await context.setCookie('csrf', 'rotated', { extraOptions: { path: '/' } });
});

const EXPECTED_COOKIES = ['session=renewed; Path=/; HttpOnly', 'csrf=rotated; Path=/'];

/**
 * An auth middleware that re-issues a sliding session cookie and a later layer that refuses the
 * request is the ordinary shape. Ergenecore keeps those cookies on the error response (Bun's
 * CookieMap is applied to whatever the fetch handler returns); this adapter used to answer a fresh
 * `Response` built from the exception and drop them, so the browser kept the stale session.
 */
describe('an error response keeps the cookies set earlier in the request', () => {
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
      path: '/forbidden',
      middlewares: [reissueSession],
      handler: () => {
        throw new HttpException(403, { error: 'Forbidden' });
      },
      staticServe: null,
      validator: null,
    } as any);

    adapter.registerRoute({
      method: HttpMethod.GET,
      path: '/crash',
      middlewares: [
        reissueSession,
        middleware(() => {
          throw new Error('downstream failure');
        }),
      ],
      handler: (context: Context) => context.send({ unreachable: true }),
      staticServe: null,
      validator: null,
    } as any);

    adapter.registerRoute({
      method: HttpMethod.GET,
      path: '/handler-only',
      middlewares: [],
      handler: async (context: Context) => {
        await context.setCookie('session', 'renewed', { extraOptions: { path: '/', httpOnly: true } });
        throw new HttpException(403, { error: 'Forbidden' });
      },
      staticServe: null,
      validator: null,
    } as any);

    adapter.registerRoute({
      method: HttpMethod.GET,
      path: '/other-headers',
      middlewares: [
        middleware((context) => {
          const hono = (context as unknown as HonoContextWrapper).context;

          hono.header('Cache-Control', 'public, max-age=3600');
          hono.header('X-Handler-State', 'half-built');
        }),
        reissueSession,
      ],
      handler: () => {
        throw new HttpException(403, { error: 'Forbidden' });
      },
      staticServe: null,
      validator: null,
    } as any);

    adapter.registerRoute({
      method: HttpMethod.GET,
      path: '/a/b/forbidden',
      middlewares: [
        middleware(async (context) => {
          await context.setCookie('session', 'renewed', { extraOptions: { path: '/a/b' } });
          await context.setCookie('root', 'renewed', { extraOptions: { path: '/' } });
        }),
      ],
      handler: () => {
        throw new HttpException(403, { error: 'Forbidden' });
      },
      staticServe: null,
      validator: null,
    } as any);

    configure?.(adapter);

    server = (await adapter.start()) as any;

    return `http://localhost:${server!.port}`;
  };

  test('403 from an HttpException carries the cookies a middleware set', async () => {
    const baseUrl = await boot();
    const response = await fetch(`${baseUrl}/forbidden`);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
    expect(response.headers.getSetCookie()).toEqual(EXPECTED_COOKIES);
  });

  test('500 from a plain Error carries the cookies a middleware set', async () => {
    const baseUrl = await boot();
    const response = await fetch(`${baseUrl}/crash`);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal Server Error' });
    expect(response.headers.getSetCookie()).toEqual(EXPECTED_COOKIES);
  });

  test('a cookie set by the handler itself survives its own throw', async () => {
    const baseUrl = await boot();
    const response = await fetch(`${baseUrl}/handler-only`);

    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie()).toEqual(['session=renewed; Path=/; HttpOnly']);
  });

  test('headers staged with a raw c.header() are not promoted onto the error response', async () => {
    const baseUrl = await boot();
    const response = await fetch(`${baseUrl}/other-headers`);

    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie()).toEqual(EXPECTED_COOKIES);
    expect(response.headers.get('cache-control')).toBeNull();
    expect(response.headers.get('x-handler-state')).toBeNull();
  });

  test('an onError that declines falls back to the default and keeps the cookies', async () => {
    const baseUrl = await boot((adapter) => adapter.onError((() => undefined) as any));
    const response = await fetch(`${baseUrl}/forbidden`);

    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie()).toEqual(EXPECTED_COOKIES);
  });

  test('an onError that returns a bare Response gets the cookies merged in', async () => {
    const baseUrl = await boot((adapter) =>
      adapter.onError(
        () =>
          new Response('refused', {
            status: 418,
            headers: { 'Set-Cookie': 'own=1; Path=/' },
          }),
      ),
    );
    const response = await fetch(`${baseUrl}/forbidden`);

    expect(response.status).toBe(418);
    expect(await response.text()).toBe('refused');
    expect(response.headers.getSetCookie()).toEqual(['own=1; Path=/', ...EXPECTED_COOKIES]);
  });

  test("an onError response's own cookie wins over the request's cookie of the same identity", async () => {
    const baseUrl = await boot((adapter) =>
      adapter.onError(
        () =>
          new Response('revoked', {
            status: 401,
            headers: { 'Set-Cookie': 'session=; Path=/; Max-Age=0' },
          }),
      ),
    );
    const response = await fetch(`${baseUrl}/forbidden`);

    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toEqual(['session=; Path=/; Max-Age=0', 'csrf=rotated; Path=/']);
  });

  test('a cookie with the same name but another Path or Domain is a different cookie and still carries over', async () => {
    const baseUrl = await boot((adapter) =>
      adapter.onError(() => {
        const headers = new Headers();

        headers.append('Set-Cookie', 'session=; Path=/admin; Max-Age=0');
        headers.append('Set-Cookie', 'session=; Domain=example.com; Path=/; Max-Age=0');

        return new Response('revoked', { status: 401, headers });
      }),
    );
    const response = await fetch(`${baseUrl}/forbidden`);

    expect(response.headers.getSetCookie()).toEqual([
      'session=; Path=/admin; Max-Age=0',
      'session=; Domain=example.com; Path=/; Max-Age=0',
      ...EXPECTED_COOKIES,
    ]);
  });

  test("a deletion without Path matches the request cookie on the request's default-path", async () => {
    const baseUrl = await boot((adapter) =>
      adapter.onError(
        () =>
          new Response('revoked', {
            status: 401,
            headers: { 'Set-Cookie': 'session=; Max-Age=0' },
          }),
      ),
    );
    const response = await fetch(`${baseUrl}/forbidden`);

    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toEqual(['session=; Max-Age=0', 'csrf=rotated; Path=/']);
  });

  test('a Path that does not start with a slash falls back to the default-path', async () => {
    const baseUrl = await boot((adapter) =>
      adapter.onError(
        () =>
          new Response('revoked', {
            status: 401,
            headers: { 'Set-Cookie': 'session=; Path=relative; Max-Age=0' },
          }),
      ),
    );
    const response = await fetch(`${baseUrl}/forbidden`);

    expect(response.headers.getSetCookie()).toEqual(['session=; Path=relative; Max-Age=0', 'csrf=rotated; Path=/']);
  });

  test('on a nested request path the default-path is the directory, not the root', async () => {
    const baseUrl = await boot((adapter) =>
      adapter.onError(() => {
        const headers = new Headers();

        headers.append('Set-Cookie', 'session=; Max-Age=0');
        headers.append('Set-Cookie', 'root=; Max-Age=0');

        return new Response('revoked', { status: 401, headers });
      }),
    );
    const response = await fetch(`${baseUrl}/a/b/forbidden`);

    // Default-path of /a/b/forbidden is /a/b: it replaces `session` (Path=/a/b) but not `root` (Path=/).
    expect(response.headers.getSetCookie()).toEqual([
      'session=; Max-Age=0',
      'root=; Max-Age=0',
      'root=renewed; Path=/',
    ]);
  });

  test('a host-only cookie and one with an explicit Domain stay distinct', async () => {
    const baseUrl = await boot((adapter) =>
      adapter.onError(
        () =>
          new Response('revoked', {
            status: 401,
            headers: { 'Set-Cookie': 'session=; Domain=localhost; Max-Age=0' },
          }),
      ),
    );
    const response = await fetch(`${baseUrl}/forbidden`);

    expect(response.headers.getSetCookie()).toEqual(['session=; Domain=localhost; Max-Age=0', ...EXPECTED_COOKIES]);
  });

  test('an onError that answers through context.send does not duplicate the cookies', async () => {
    const baseUrl = await boot((adapter) => adapter.onError((_error, context) => context.send({ mine: true }, 403)));
    const response = await fetch(`${baseUrl}/forbidden`);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ mine: true });
    expect(response.headers.getSetCookie()).toEqual(EXPECTED_COOKIES);
  });
});
