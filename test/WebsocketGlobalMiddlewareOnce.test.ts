import { describe, expect, it, afterEach, mock } from 'bun:test';
import type { Server } from 'bun';
import { AsenaWebSocketService } from '@asenajs/asena/web-socket';
import type { BaseMiddleware } from '@asenajs/asena/adapter';
import type { Context as HonoAdapterContext } from '../lib/defaults';
import { createTestAdapter, startTestServer, registerRoute } from './utils/testHelpers';

class SilentWebSocketService extends AsenaWebSocketService<any> {
  protected async onOpen(_ws: any) {}
}

const createWsService = (namespace: string): SilentWebSocketService => {
  const service = new SilentWebSocketService();

  service.namespace = namespace;

  return service;
};

interface Counter {
  middleware: BaseMiddleware<HonoAdapterContext>;
  calls: number;
}

const counting = (): Counter => {
  const counter: Counter = {
    calls: 0,
    middleware: undefined as unknown as BaseMiddleware<HonoAdapterContext>,
  };

  counter.middleware = {
    handle: mock(async (_ctx: HonoAdapterContext, next: () => Promise<void>) => {
      counter.calls++;
      await next();

      return true;
    }),
    override: false,
  };

  return counter;
};

const openSocket = (url: string): Promise<'open' | 'error' | 'timeout'> =>
  new Promise((resolve) => {
    const ws = new WebSocket(url);

    ws.onopen = () => {
      ws.close();
      resolve('open');
    };
    ws.onerror = () => resolve('error');
    setTimeout(() => resolve('timeout'), 3000);
  });

// A WebSocket handshake ran every global middleware twice: once from the top-level app.use()
// registration and once more from the WebSocket route's own chain. A global rate limiter charged
// two tokens for one handshake.
describe('WebSocket handshake global middlewares', () => {
  let server: Server<any> | undefined;

  afterEach(() => {
    if (server) {
      server.stop(true);
      server = undefined;
    }
  });

  it('should run each global middleware exactly once per handshake', async () => {
    const { adapter } = createTestAdapter();
    const global = counting();
    const scoped = counting();
    const route = counting();

    await adapter.use(global.middleware);
    await adapter.use(scoped.middleware, { include: ['/ws'] });

    await registerRoute(adapter, { path: '/http', handler: (ctx) => ctx.send({ ok: true }) });

    adapter.registerWebsocketRoute({
      path: 'ws',
      middlewares: [route.middleware],
      websocketService: createWsService('ws') as any,
    });

    const { server: started, baseUrl, port } = await startTestServer(adapter);

    server = started;

    expect((await fetch(`${baseUrl}/http`)).status).toBe(200);

    expect(global.calls).toBe(1);
    expect(scoped.calls).toBe(0);
    expect(route.calls).toBe(0);

    expect(await openSocket(`ws://localhost:${port}/ws`)).toBe('open');

    // The top-level app.use() already covers the WebSocket route's app.get(), so the route must
    // not add the global chain a second time.
    expect(global.calls).toBe(2);
    expect(scoped.calls).toBe(1);
    expect(route.calls).toBe(1);
  });

  it('should still let a global middleware reject the handshake, running it once', async () => {
    const { adapter } = createTestAdapter();
    let calls = 0;

    const denying: BaseMiddleware<HonoAdapterContext> = {
      handle: mock(async () => {
        calls++;

        return new Response(null, { status: 401 });
      }),
      override: false,
    };

    await adapter.use(denying);

    adapter.registerWebsocketRoute({
      path: 'ws',
      middlewares: [],
      websocketService: createWsService('ws') as any,
    });

    const { server: started, port } = await startTestServer(adapter);

    server = started;

    expect(await openSocket(`ws://localhost:${port}/ws`)).toBe('error');
    expect(calls).toBe(1);
  });
});
