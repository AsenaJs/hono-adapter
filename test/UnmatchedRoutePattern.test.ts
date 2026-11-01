import { afterEach, describe, expect, it } from 'bun:test';
import type { Server } from 'bun';
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

  async function boot(config?: { include?: string[]; exclude?: string[] }) {
    const seen: Seen = {};
    const { adapter } = createTestAdapter();
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
});
