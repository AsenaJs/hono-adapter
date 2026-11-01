import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'bun';
import { Hono } from 'hono';
import type { BaseMiddleware } from '@asenajs/asena/adapter';
import type { Context as HonoAdapterContext } from '../lib/defaults';
import { createTestAdapter, registerRoute, startTestServer } from './utils/testHelpers';

type Seen = Record<string, { before: string | undefined; after: string | undefined }>;

function recordingMiddleware(seen: Seen): BaseMiddleware<HonoAdapterContext> {
  return {
    handle: async (context: HonoAdapterContext, next: () => Promise<void>) => {
      const path = new URL(context.req.url).pathname;
      const before = context.routePattern;

      await next();
      seen[path] = { before, after: context.routePattern };
    },
    override: false,
  } as BaseMiddleware<HonoAdapterContext>;
}

describe('routePattern on matched and unmatched requests', () => {
  let server: Server<any> | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  async function boot(config?: { include?: string[]; exclude?: string[] }, app?: Hono) {
    const seen: Seen = {};
    const { adapter } = createTestAdapter({ app });
    let handlerPattern: string | undefined;

    adapter.use(recordingMiddleware(seen), config as any);
    await registerRoute(adapter, {
      path: '/api/items/:id',
      handler: (ctx) => {
        handlerPattern = ctx.routePattern;

        return ctx.send({ id: ctx.getParam('id') });
      },
    });

    const started = await startTestServer(adapter);

    server = started.server;

    return { seen, baseUrl: started.baseUrl, handlerPattern: () => handlerPattern };
  }

  it('reports the declared pattern to a global middleware and the handler on a matched route', async () => {
    const { seen, baseUrl, handlerPattern } = await boot();
    const res = await fetch(`${baseUrl}/api/items/42`);

    expect(res.status).toBe(200);
    expect(handlerPattern()).toBe('/api/items/:id');
    expect(seen['/api/items/42']).toEqual({ before: '/api/items/:id', after: '/api/items/:id' });
  });

  it('leaves routePattern unset for a global middleware on an unmatched request', async () => {
    const { seen, baseUrl } = await boot();
    const res = await fetch(`${baseUrl}/nothing/here`);

    expect(res.status).toBe(404);
    expect('/nothing/here' in seen).toBe(true);
    expect(seen['/nothing/here']).toEqual({ before: undefined, after: undefined });
  });

  it('leaves routePattern unset when the global middleware is limited to an include pattern', async () => {
    const { seen, baseUrl } = await boot({ include: ['/api/*'] });
    const res = await fetch(`${baseUrl}/api/missing`);

    expect(res.status).toBe(404);
    expect('/api/missing' in seen).toBe(true);
    expect(seen['/api/missing']).toEqual({ before: undefined, after: undefined });
  });

  it('leaves routePattern unset when the global middleware has an exclude pattern', async () => {
    const { seen, baseUrl } = await boot({ exclude: ['/health'] });
    const matched = await fetch(`${baseUrl}/api/items/7`);
    const res = await fetch(`${baseUrl}/nothing/here`);

    expect(matched.status).toBe(200);
    expect(seen['/api/items/7']).toEqual({ before: '/api/items/:id', after: '/api/items/:id' });
    expect(res.status).toBe(404);
    expect(seen['/nothing/here']).toEqual({ before: undefined, after: undefined });
  });

  function appWithNativeMiddleware() {
    const app = new Hono();

    app.use('*', async (_c, next) => {
      await next();
    });
    app.use('/api/*', async (_c, next) => {
      await next();
    });

    return app;
  }

  it('skips native middleware of a custom app when reporting the matched pattern', async () => {
    const { seen, baseUrl, handlerPattern } = await boot(undefined, appWithNativeMiddleware());
    const res = await fetch(`${baseUrl}/api/items/42`);

    expect(res.status).toBe(200);
    expect(handlerPattern()).toBe('/api/items/:id');
    expect(seen['/api/items/42']).toEqual({ before: '/api/items/:id', after: '/api/items/:id' });
  });

  it('leaves routePattern unset on an unmatched request through native middleware of a custom app', async () => {
    const { seen, baseUrl } = await boot(undefined, appWithNativeMiddleware());
    const res = await fetch(`${baseUrl}/api/missing`);

    expect(res.status).toBe(404);
    expect('/api/missing' in seen).toBe(true);
    expect(seen['/api/missing']).toEqual({ before: undefined, after: undefined });
  });

  describe('after a static route falls through', () => {
    const root = mkdtempSync(join(tmpdir(), 'asena-route-pattern-static-'));

    writeFileSync(join(root, 'app.css'), 'body{}');

    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
    });

    async function bootWithFallback() {
      const seen: Seen = {};
      const { adapter } = createTestAdapter();
      const handlerPatterns: (string | undefined)[] = [];

      adapter.use(recordingMiddleware(seen));
      await registerRoute(adapter, {
        path: '/assets/:file',
        handler: (ctx) => ctx.send({ handler: 'assets' }),
        staticServe: { root, rewriteRequestPath: (requestPath: string) => requestPath.replace('/assets', '') },
      });
      await registerRoute(adapter, {
        path: '/*',
        handler: (ctx) => {
          handlerPatterns.push(ctx.routePattern);

          return ctx.send({ handler: 'fallback' });
        },
      });

      const started = await startTestServer(adapter);

      server = started.server;

      return { seen, baseUrl: started.baseUrl, handlerPatterns };
    }

    it('reports the fallback endpoint that answers a missing asset', async () => {
      const { seen, baseUrl, handlerPatterns } = await bootWithFallback();
      const res = await fetch(`${baseUrl}/assets/missing.css`);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ handler: 'fallback' });
      expect(handlerPatterns).toEqual(['/*']);
      expect(seen['/assets/missing.css']).toEqual({ before: '/assets/:file', after: '/*' });
    });

    it('keeps the static pattern when the asset is served', async () => {
      const { seen, baseUrl, handlerPatterns } = await bootWithFallback();
      const res = await fetch(`${baseUrl}/assets/app.css`);

      expect(res.status).toBe(200);
      expect(await res.text()).toBe('body{}');
      expect(handlerPatterns).toEqual([]);
      expect(seen['/assets/app.css']).toEqual({ before: '/assets/:file', after: '/assets/:file' });
    });
  });
});
