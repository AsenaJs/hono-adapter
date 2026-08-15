import { afterEach, describe, expect, it } from 'bun:test';
import type { Server } from 'bun';
import { AsenaWebSocketService } from '@asenajs/asena/web-socket';
import type { WebSocketTransport } from '@asenajs/asena/web-socket';
import { BunLocalTransport } from '@asenajs/asena/web-socket';
import { createTestAdapter, registerRoute, sleep, startTestServer } from './utils/testHelpers';

/**
 * A socket service that subscribes the connecting client to a room and immediately publishes to
 * it - the shape the production bug was found in. The connecting client must never see its own
 * publish, whatever transport the application configured.
 */
class PublishOnOpenService extends AsenaWebSocketService<any> {
  protected async onOpen(ws: any) {
    ws.subscribe('room');
    ws.publish('room', JSON.stringify({ action: 'connect' }));
  }
}

/**
 * Stands in for `@asenajs/asena-redis`'s RedisTransport without needing a broker: `publish()` does
 * local delivery plus the wire, `publishRemote()` is the wire alone. "The wire" here is a counter,
 * since there is no second pod in a unit test.
 */
class FakeRemoteTransport implements WebSocketTransport {
  public remoteCalls: Array<{ topic: string; data: unknown }> = [];

  private server!: Server<any>;

  public async init(server: Server<any>): Promise<void> {
    this.server = server;
  }

  public publish(topic: string, data: string | ArrayBuffer | ArrayBufferView): void {
    this.server.publish(topic, data as string);
    this.publishRemote(topic, data);
  }

  public publishRemote(topic: string, data: string | ArrayBuffer | ArrayBufferView): void {
    this.remoteCalls.push({ topic, data });
  }
}

/** Counts the frames one client receives over `ms`, mirroring the reproduction in the bug report. */
async function countFramesOnConnect(port: number, path: string, ms = 400): Promise<number> {
  const ws = new WebSocket(`ws://localhost:${port}${path}`);
  let frames = 0;

  ws.onmessage = () => {
    frames++;
  };

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WS open timeout')), 3000);

    ws.onopen = () => {
      clearTimeout(timeout);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('WebSocket error'));
    };
  });

  await sleep(ms);
  ws.close();
  await sleep(50);

  return frames;
}

/**
 * `transport()` is documented as being about cross-pod delivery. Configuring it used to change
 * *local* fan-out for every `socket.publish()` in the application: without a transport the socket
 * took Bun's `ws.publish()` (sender excluded), with one it took `server.publish()` through the
 * transport (sender included). Nothing in the API surface said so, and the failure was a duplicate
 * message rather than an error - it surfaced as a client-side bug far from its cause.
 */
describe('socket.publish() self-delivery does not depend on the transport', () => {
  let server: Server<any> | undefined;

  afterEach(async () => {
    if (server) {
      server.stop(true);
      server = undefined;
      await sleep(20);
    }
  });

  async function boot(transport?: WebSocketTransport) {
    const { adapter, wsAdapter } = createTestAdapter();

    if (transport) {
      wsAdapter.transport = transport;
    }

    const service = new PublishOnOpenService();

    service.namespace = 'rooms';

    adapter.registerWebsocketRoute({
      path: 'rooms',
      middlewares: [],
      websocketService: service as any,
    } as any);

    // A plain route so the adapter has an HTTP surface to start
    await registerRoute(adapter, { path: '/health', handler: (ctx) => ctx.send({ ok: true }) });

    const { server: s } = await startTestServer(adapter);

    server = s;

    return { adapter, wsAdapter, port: s.port };
  }

  it('excludes the publishing socket with no transport configured', async () => {
    const { port } = await boot();

    expect(await countFramesOnConnect(port, '/rooms')).toBe(0);
  });

  it('still excludes the publishing socket once a transport is configured', async () => {
    const transport = new FakeRemoteTransport();
    const { port } = await boot(transport);

    // This is the load-bearing assertion of the whole fix. Before it, this count was 1: the
    // publish came back to the socket that sent it, and applications carrying the compensating
    // ws.send() saw 2.
    expect(await countFramesOnConnect(port, '/rooms')).toBe(0);

    // ...and the message still went out to the other pods, which is the transport's actual job.
    expect(transport.remoteCalls).toHaveLength(1);
    expect(transport.remoteCalls[0].topic).toBe('rooms.room');
  });

  it('writes the default BunLocalTransport back to the field', async () => {
    const { wsAdapter } = await boot();

    // The default used to be assigned to a local, so sockets - built from the field - got
    // undefined while AsenaWebSocketServer got the default. That is what made the framework's own
    // two broadcast paths disagree in the default configuration, and it also hid the default from
    // the shutdown path, which reads the same field.
    expect(wsAdapter.transport).toBeInstanceOf(BunLocalTransport);
  });

  it('warns once at startup when the transport has no publishRemote', async () => {
    const legacy: WebSocketTransport = {
      publish() {
        // legacy contract: local + remote in one call
      },
    };

    const { adapter, logger } = createTestAdapter();
    const wsAdapter = (adapter as any).websocketAdapter;

    wsAdapter.transport = legacy;

    const service = new PublishOnOpenService();

    service.namespace = 'legacy';

    adapter.registerWebsocketRoute({
      path: 'legacy',
      middlewares: [],
      websocketService: service as any,
    } as any);

    await registerRoute(adapter, { path: '/health', handler: (ctx) => ctx.send({ ok: true }) });

    const { server: s } = await startTestServer(adapter);

    server = s;

    // Silently dropping cross-pod delivery for such a transport would be the worse failure, so we
    // keep its old behaviour and say so - once, at startup, not per message.
    const warned = (logger.warn as any).mock.calls.some((call: any[]) => String(call[0]).includes('publishRemote'));

    expect(warned).toBe(true);
  });
});
