import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { Server } from 'bun';
import { AsenaWebSocketService, type WebSocketTransport } from '@asenajs/asena/web-socket';
import { Container } from '@asenajs/asena/container';
import { HonoWebsocketAdapter } from '../lib/HonoWebsocketAdapter';
import { RateLimiterMiddleware } from '../lib/middlewares/RateLimiterMiddleware';
import { createMockLogger, createTestAdapter, registerRoute, sleep, startTestServer } from './utils/testHelpers';

/**
 * Minimal WebSocket service - the adapter only starts a transport when at least one namespace
 * is registered, so every transport test needs one.
 */
class TestWebSocketService extends AsenaWebSocketService<any> {
  protected async onMessage(ws: any, message: Buffer | string) {
    ws.send(typeof message === 'string' ? message : message.toString());
  }
}

function createTestWsService(namespace: string): TestWebSocketService {
  const service = new TestWebSocketService();

  service.namespace = namespace;

  return service;
}

/**
 * A stand-in for a remote transport (RedisTransport and friends): the only thing under test is
 * whether `destroy()` is reached, so the publish path is a no-op.
 */
function createRecordingTransport(destroyImpl?: () => Promise<void>) {
  const destroy = mock(destroyImpl ?? (async () => {}));

  const transport: WebSocketTransport = {
    publish: () => {},
    init: async () => {},
    destroy,
  };

  return { transport, destroy };
}

describe('Shutdown', () => {
  let server: Server<any> | undefined;

  afterEach(() => {
    if (server) {
      server.stop(true);
      server = undefined;
    }
  });

  // ─── Transport teardown ───────────────────────────────────────────

  describe('WebSocket transport', () => {
    it('should reach transport.destroy() through adapter.stop()', async () => {
      const { adapter, wsAdapter } = createTestAdapter();
      const { transport, destroy } = createRecordingTransport();

      wsAdapter.transport = transport;

      adapter.registerWebsocketRoute({
        path: 'chat',
        middlewares: [],
        websocketService: createTestWsService('chat') as any,
      });

      await registerRoute(adapter, { path: '/health' });

      const { server: s, port } = await startTestServer(adapter);

      server = s;

      expect(destroy).not.toHaveBeenCalled();

      await adapter.stop();
      server = undefined;

      expect(destroy).toHaveBeenCalledTimes(1);
      // ...and the socket really is down, not merely reported as such
      await expect(fetch(`http://localhost:${port}/health`)).rejects.toThrow();
    });

    it('should reach transport.destroy() through wsAdapter.shutdown()', async () => {
      const logger = createMockLogger();
      const wsAdapter = new HonoWebsocketAdapter(logger);
      const { transport, destroy } = createRecordingTransport();

      wsAdapter.transport = transport;

      await wsAdapter.shutdown();

      expect(destroy).toHaveBeenCalledTimes(1);
    });

    it('should survive a transport whose destroy() rejects', async () => {
      const logger = createMockLogger();
      const wsAdapter = new HonoWebsocketAdapter(logger);
      const { transport } = createRecordingTransport(async () => {
        throw new Error('broker unreachable');
      });

      wsAdapter.transport = transport;

      await wsAdapter.shutdown();

      expect(logger.error).toHaveBeenCalled();
      // The rest of the teardown still ran
      expect(logger.info).toHaveBeenCalledWith('WebSocket shutdown complete');
    });

    it('should bound a transport whose destroy() never settles', async () => {
      const logger = createMockLogger();
      const wsAdapter = new HonoWebsocketAdapter(logger);
      const { transport } = createRecordingTransport(() => new Promise<void>(() => {}));

      wsAdapter.transport = transport;

      const started = Date.now();

      await wsAdapter.shutdown(50);

      // The whole point of the timeout: an unreachable broker must not hold the shutdown open
      expect(Date.now() - started).toBeLessThan(2000);
      expect(logger.error).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('WebSocket shutdown complete');
    });

    it('should not fail when no transport was configured', async () => {
      const logger = createMockLogger();
      const wsAdapter = new HonoWebsocketAdapter(logger);

      await wsAdapter.shutdown();

      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  // ─── Heartbeats ───────────────────────────────────────────────────

  describe('Heartbeats', () => {
    it('should clear heartbeat intervals of still-open connections', async () => {
      const { adapter, wsAdapter } = createTestAdapter();

      adapter.registerWebsocketRoute({
        path: 'beat',
        middlewares: [],
        websocketService: createTestWsService('beat') as any,
      });

      await registerRoute(adapter, { path: '/health' });

      await adapter.serveOptions(() => ({
        wsOptions: { sendPingStrategy: 'adapter', heartbeatInterval: 50, idleTimeout: 0 },
      }));

      const { server: s } = await startTestServer(adapter);

      server = s;

      const ws = new WebSocket(`ws://localhost:${server.port}/beat`);

      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve();
      });

      await sleep(50);

      // Read through the protected field: a live timer has no public surface, and the point of
      // the test is that nothing is left behind rather than that some getter says so.
      const heartbeats = wsAdapter['heartbeatIntervals'] as Map<string, Timer>;

      expect(heartbeats.size).toBe(1);

      // Directly, with the connection still open - stopping the server first would empty the map
      // via the close handler and prove nothing about shutdown().
      await wsAdapter.shutdown();

      expect(heartbeats.size).toBe(0);
      expect(wsAdapter.getConnectionCount('beat')).toBe(0);

      ws.close();
      await sleep(50);
    });
  });

  // ─── Failure containment ──────────────────────────────────────────

  describe('Failure containment', () => {
    it('should stop the HTTP server even when the WebSocket shutdown throws', async () => {
      const { adapter, wsAdapter, logger } = createTestAdapter();

      await registerRoute(adapter, { path: '/health' });

      const { server: s, port } = await startTestServer(adapter);

      server = s;

      wsAdapter.shutdown = mock(async () => {
        throw new Error('shutdown exploded');
      });

      await adapter.stop();
      server = undefined;

      expect(logger.error).toHaveBeenCalled();
      await expect(fetch(`http://localhost:${port}/health`)).rejects.toThrow();
    });

    it('should release the transport even when server.stop() fails', async () => {
      const { adapter, wsAdapter } = createTestAdapter();
      const { transport, destroy } = createRecordingTransport();

      wsAdapter.transport = transport;

      // A Bun server that refuses to stop cannot be produced on demand, so stand one in. The
      // branch being covered is the `finally`, not Bun's behaviour.
      adapter['server'] = {
        stop: () => {
          throw new Error('stop failed');
        },
      } as any;

      await expect(adapter.stop()).rejects.toThrow('stop failed');

      expect(destroy).toHaveBeenCalledTimes(1);
    });

    it('should be safe to stop twice', async () => {
      const { adapter, wsAdapter } = createTestAdapter();
      const { transport, destroy } = createRecordingTransport();

      wsAdapter.transport = transport;

      await registerRoute(adapter, { path: '/health' });

      const { server: s } = await startTestServer(adapter);

      server = s;

      await adapter.stop();
      await adapter.stop();
      server = undefined;

      expect(destroy).toHaveBeenCalledTimes(2);
    });
  });

  // ─── Component lifecycle ──────────────────────────────────────────

  describe('RateLimiterMiddleware lifecycle', () => {
    it('should expose destroy() as an @OnStop hook', () => {
      // The container's own walk, so the test cannot disagree with what the framework would run
      const stopHooks = new Container().getStopHooks(RateLimiterMiddleware as any);

      expect(stopHooks).toContain('destroy');
    });

    it('should inherit the hook in the subclass users actually register', () => {
      class ApiRateLimiter extends RateLimiterMiddleware {}

      const stopHooks = new Container().getStopHooks(ApiRateLimiter as any);

      expect(stopHooks).toEqual(['destroy']);
    });

    it('should drop timer and buckets so a restart starts clean', () => {
      const limiter = new RateLimiterMiddleware({ capacity: 5, refillRate: 1, cleanupInterval: 1000 });

      limiter['buckets'].set('1.2.3.4', { tokens: 0, lastRefill: Date.now() });

      expect(limiter.getBucketState('1.2.3.4')).toBeDefined();
      expect(limiter['cleanupTimer']).toBeDefined();

      limiter.destroy();

      expect(limiter.getBucketState('1.2.3.4')).toBeUndefined();
      expect(limiter['cleanupTimer']).toBeUndefined();

      // Second call has nothing left to do, and must not throw
      limiter.destroy();
    });
  });
});
