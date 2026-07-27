import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { HonoAdapter } from '../lib/HonoAdapter';
import type { Context } from '../lib/defaults/Context';
import { HttpMethod } from '@asenajs/asena/web-types';
import type { ServerLogger } from '@asenajs/asena/logger';

const mockLogger: ServerLogger = {
  profile: mock(() => {}),
  info: mock(() => {}),
  error: mock(() => {}),
  warn: mock(() => {}),
};

/**
 * Byte-for-byte the same contract as `ergenecore/test/staticNotFound.test.ts` - this adapter had
 * no static-serve test at all.
 *
 * A missing static file and an unmatched route are two different things, but an application
 * should be able to shape both 404s in one place.
 *
 * They used to diverge: ergenecore answered a hard-coded `text/plain` "Not Found" and never
 * consulted the config hook, while on the hono adapter `serveStatic` calls `next()` after its
 * own onNotFound, so the request fell through to `app.notFound` - i.e. the config hook. The
 * same application produced a different body depending on the adapter, which is the exact
 * portability complaint this release set out to answer.
 *
 * `StaticServeService.onNotFound` (per-route, file-level) still runs first and can still take
 * over with `override: true`.
 */
describe('static file 404 goes through the application onNotFound', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asena-static-hono-'));

  let adapter: HonoAdapter;
  let server: any;

  beforeAll(() => {
    fs.writeFileSync(path.join(root, 'present.txt'), 'here');
  });

  afterAll(async () => {
    await server?.stop(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  const boot = async (options: { withHook?: boolean; fileHookOverride?: boolean } = {}) => {
    await server?.stop(true);

    adapter = new HonoAdapter(mockLogger);
    adapter.setPort(0);

    if (options.withHook) {
      adapter.onNotFound((context: Context, request) => context.send({ shaped: true, path: request.path }, 404));
    }

    adapter.registerRoute({
      method: HttpMethod.GET,
      path: '/assets/*',
      middlewares: [],
      handler: async (context: Context) => context.send({ fellThrough: true }),
      staticServe: {
        root,
        extra: {},
        rewriteRequestPath: (requestPath: string) => requestPath.replace('/assets', ''),
        onNotFound: {
          handler: async () => {},
          override: options.fileHookOverride ?? false,
        },
      },
      validator: {} as any,
    } as any);

    server = await adapter.start();

    return `http://localhost:${server.port}`;
  };

  test('a missing file reaches the config onNotFound', async () => {
    const baseUrl = await boot({ withHook: true });
    const response = await fetch(`${baseUrl}/assets/nope.txt`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ shaped: true, path: '/assets/nope.txt' });
  });

  test('with no config hook it answers the shared JSON envelope, not text/plain', async () => {
    const baseUrl = await boot();
    const response = await fetch(`${baseUrl}/assets/nope.txt`);

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: 'Not Found' });
  });

  test('a present file is still served', async () => {
    const baseUrl = await boot({ withHook: true });
    const response = await fetch(`${baseUrl}/assets/present.txt`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('here');
  });

  test('override on the per-route hook means something different here than on ergenecore', async () => {
    const baseUrl = await boot({ withHook: true, fileHookOverride: true });
    const response = await fetch(`${baseUrl}/assets/nope.txt`);

    // KNOWN DIVERGENCE, pre-existing and pinned deliberately rather than papered over.
    //
    // On ergenecore `override: true` means "I answered it, continue to the route handler", and
    // that test asserts a 200 from the handler. Here it only selects whether the hook receives
    // the raw Hono context instead of a wrapped one: `serveStatic` is registered *instead of*
    // the route handler (there is nothing to fall through to), and it always calls next(),
    // which lands in app.notFound.
    //
    // Two different features sharing one name. Worth reconciling, but changing Hono's routing
    // is a bigger decision than the 404-envelope fix this suite exists for.
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ shaped: true, path: '/assets/nope.txt' });
  });
});
