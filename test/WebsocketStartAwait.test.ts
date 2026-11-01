import { afterEach, describe, expect, it } from 'bun:test';
import { AsenaWebSocketService, type WebSocketTransport } from '@asenajs/asena/web-socket';
import { createTestAdapter, registerRoute, sleep } from './utils/testHelpers';
import type { HonoAdapter } from '../lib/HonoAdapter';

class EchoSocket extends AsenaWebSocketService<any> {
  protected async onMessage(ws: any, message: Buffer | string) {
    ws.send(typeof message === 'string' ? message : message.toString());
  }
}

function createDelayedTransport(delayMs: number, fail = false) {
  const state = { initCompleted: false };

  const transport: WebSocketTransport = {
    publish: () => {},
    init: () =>
      new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          if (fail) {
            reject(new Error('transport init failed'));

            return;
          }

          state.initCompleted = true;
          resolve();
        }, delayMs);
      }),
    destroy: async () => {},
  };

  return { transport, state };
}

async function createAdapterWithSocket(transport: WebSocketTransport) {
  const { adapter, wsAdapter } = createTestAdapter();
  const service = new EchoSocket();

  service.namespace = 'echo';
  wsAdapter.transport = transport;

  adapter.registerWebsocketRoute({ path: 'echo', middlewares: [], websocketService: service as any });
  await registerRoute(adapter, { path: '/health' });

  return { adapter, service };
}

describe('WebSocket start awaits transport init', () => {
  let adapter: HonoAdapter | undefined;

  afterEach(async () => {
    await adapter?.stop();
    adapter = undefined;
  });

  it('start() resolves only after transport.init completed and service.server is assigned', async () => {
    const { transport, state } = createDelayedTransport(100);
    const created = await createAdapterWithSocket(transport);

    adapter = created.adapter;

    await adapter.start();

    expect(state.initCompleted).toBe(true);
    expect(created.service.server).toBeDefined();
  });

  it('a rejecting transport.init rejects start() instead of escaping as an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);

    process.on('unhandledRejection', onUnhandled);

    try {
      const { transport } = createDelayedTransport(50, true);
      const created = await createAdapterWithSocket(transport);

      adapter = created.adapter;

      let startError: unknown;

      try {
        await adapter.start();
      } catch (error) {
        startError = error;
      }

      await sleep(100);

      expect(startError).toBeInstanceOf(Error);
      expect((startError as Error).message).toBe('transport init failed');
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
