import { describe, expect, it, afterEach, mock } from 'bun:test';
import type { Server } from 'bun';
import { HonoWebsocketAdapter } from '../lib/HonoWebsocketAdapter';
import { AsenaWebSocketService } from '@asenajs/asena/web-socket';
import { HttpMethod } from '@asenajs/asena/web-types';
import {
  createMockLogger,
  createTestAdapter,
  startTestServer,
  registerRoute,
  sleep,
} from './utils/testHelpers';

// Helper to create a minimal WebSocket service for testing
class TestWebSocketService extends AsenaWebSocketService<any> {
  public onOpenMock = mock(async () => {});
  public onMessageMock = mock(async (_ws: any, _msg: any) => {});
  public onCloseMock = mock(async (_ws: any, _code: number, _reason: string) => {});

  protected async onOpen(ws: any) {
    await this.onOpenMock(ws);
  }

  protected async onMessage(ws: any, message: Buffer | string) {
    // Echo messages back
    ws.send(typeof message === 'string' ? message : message.toString());
    await this.onMessageMock(ws, message);
  }

  protected async onClose(ws: any, code: number, reason: string) {
    await this.onCloseMock(ws, code, reason);
  }
}

function createTestWsService(ns: string): TestWebSocketService {
  const service = new TestWebSocketService();
  service.namespace = ns;
  return service;
}

describe('HonoWebsocketAdapter', () => {
  let server: Server<any> | undefined;

  afterEach(async () => {
    if (server) {
      server.stop(true);
      server = undefined;
    }
  });

  // ─── Registration Validation ──────────────────────────────────────

  describe('Registration Validation', () => {
    it('should create an adapter instance', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      expect(adapter).toBeDefined();
      expect(adapter.name).toBe('HonoWebsocketAdapter');
    });

    it('should throw for null service', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      expect(() => adapter.registerWebSocket(null as any)).toThrow('WebSocket service is required');
    });

    it('should throw for missing namespace', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      const service = new TestWebSocketService();
      // namespace is not set

      expect(() => adapter.registerWebSocket(service as any)).toThrow(
        'WebSocket namespace is required',
      );
    });

    it('should throw for invalid namespace format', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      const service = createTestWsService('invalid namespace!');

      expect(() => adapter.registerWebSocket(service as any)).toThrow('Invalid WebSocket namespace format');
    });

    it('should accept valid namespace formats', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      // These should all work without throwing
      for (const ns of ['chat', 'my-chat', 'my_chat', 'chat/room', 'v1/chat-room']) {
        const service = createTestWsService(ns);
        adapter.registerWebSocket(service as any);
      }
    });

    it('should warn on duplicate namespace', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      const service1 = createTestWsService('chat');
      const service2 = createTestWsService('chat');

      adapter.registerWebSocket(service1 as any);
      adapter.registerWebSocket(service2 as any);

      expect(logger.warn).toHaveBeenCalled();
    });
  });

  // ─── Connection Management ────────────────────────────────────────

  describe('Connection Management', () => {
    it('setConnectionLimit should accept valid limit', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      adapter.setConnectionLimit('chat', 100);
      // No throw
    });

    it('setConnectionLimit should throw for limit < 1', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      expect(() => adapter.setConnectionLimit('chat', 0)).toThrow(
        'Connection limit must be at least 1',
      );
    });

    it('getConnectionCount should return 0 initially', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      expect(adapter.getConnectionCount('chat')).toBe(0);
    });
  });

  // ─── WebSocket Integration ────────────────────────────────────────

  describe('WebSocket Integration', () => {
    it('should accept WebSocket connection and echo messages', async () => {
      const { adapter, wsAdapter } = createTestAdapter();

      const wsService = createTestWsService('echo');

      adapter.registerWebsocketRoute({
        path: 'echo',
        middlewares: [],
        websocketService: wsService as any,
      });

      await registerRoute(adapter, {
        path: '/health',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s } = await startTestServer(adapter);
      server = s;

      const ws = new WebSocket(`ws://localhost:${server.port}/echo`);

      const messagePromise = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('WS message timeout')), 3000);

        ws.onmessage = (e) => {
          clearTimeout(timeout);
          resolve(typeof e.data === 'string' ? e.data : '');
        };

        ws.onerror = (e) => {
          clearTimeout(timeout);
          reject(new Error('WebSocket error'));
        };
      });

      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve();
      });

      ws.send('hello');

      const response = await messagePromise;
      expect(response).toBe('hello');

      ws.close();
      await sleep(50);
    });

    it('should track connection count', async () => {
      const { adapter, wsAdapter } = createTestAdapter();

      const wsService = createTestWsService('tracked');

      adapter.registerWebsocketRoute({
        path: 'tracked',
        middlewares: [],
        websocketService: wsService as any,
      });

      await registerRoute(adapter, {
        path: '/health',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s } = await startTestServer(adapter);
      server = s;

      const ws = new WebSocket(`ws://localhost:${server.port}/tracked`);
      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve();
      });

      await sleep(50);
      expect(wsAdapter.getConnectionCount('tracked')).toBe(1);

      ws.close();
      await sleep(100);

      expect(wsAdapter.getConnectionCount('tracked')).toBe(0);
    });

    it('should enforce connection limit', async () => {
      const { adapter, wsAdapter } = createTestAdapter();

      const wsService = createTestWsService('limited');
      wsAdapter.setConnectionLimit('limited', 1);

      adapter.registerWebsocketRoute({
        path: 'limited',
        middlewares: [],
        websocketService: wsService as any,
      });

      await registerRoute(adapter, {
        path: '/health',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s } = await startTestServer(adapter);
      server = s;

      // First connection should succeed
      const ws1 = new WebSocket(`ws://localhost:${server.port}/limited`);
      await new Promise<void>((resolve) => {
        ws1.onopen = () => resolve();
      });

      // Second connection should be rejected
      const ws2 = new WebSocket(`ws://localhost:${server.port}/limited`);
      const closePromise = new Promise<number>((resolve) => {
        ws2.onclose = (e) => resolve(e.code);
      });

      const closeCode = await closePromise;
      expect(closeCode).toBe(1008);

      ws1.close();
      await sleep(50);
    });
  });

  // ─── Ping Strategy ─────────────────────────────────────────────────

  describe('Ping Strategy', () => {
    it('should default to adapter strategy (sendPings: false)', async () => {
      const { adapter } = createTestAdapter();

      const wsService = createTestWsService('default-strategy');

      adapter.registerWebsocketRoute({
        path: 'default-strategy',
        middlewares: [],
        websocketService: wsService as any,
      });

      await registerRoute(adapter, {
        path: '/health',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s } = await startTestServer(adapter);
      server = s;

      // Default strategy is 'adapter' → sendPings should be false
      // Connection should still open and work for messages
      const ws = new WebSocket(`ws://localhost:${server.port}/default-strategy`);
      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve();
      });

      expect(ws.readyState).toBe(WebSocket.OPEN);

      const echoPromise = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timeout')), 2000);

        ws.onmessage = (e) => {
          clearTimeout(timeout);
          resolve(typeof e.data === 'string' ? e.data : '');
        };
      });

      ws.send('ping test');
      expect(await echoPromise).toBe('ping test');

      ws.close();
      await sleep(50);
    });

    it('should keep connection alive with adapter heartbeat (sendPingStrategy: adapter)', async () => {
      const { adapter } = createTestAdapter();

      const wsService = createTestWsService('adapter-heartbeat');

      adapter.registerWebsocketRoute({
        path: 'adapter-heartbeat',
        middlewares: [],
        websocketService: wsService as any,
      });

      await registerRoute(adapter, {
        path: '/health',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      // adapter strategy + heartbeatInterval: adapter sends ws.ping() to keep alive
      await adapter.serveOptions(() => ({
        wsOptions: {
          sendPingStrategy: 'adapter',
          heartbeatInterval: 50,
          idleTimeout: 2,
          perMessageDeflate: false,
        },
      }));

      const { server: s } = await startTestServer(adapter);
      server = s;

      const ws = new WebSocket(`ws://localhost:${server.port}/adapter-heartbeat`);
      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve();
      });

      // Wait longer than idleTimeout (2s) — heartbeat should keep it alive
      await sleep(3000);

      expect(ws.readyState).toBe(WebSocket.OPEN);

      // Verify connection still works
      const echoPromise = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timeout')), 2000);

        ws.onmessage = (e) => {
          clearTimeout(timeout);
          resolve(typeof e.data === 'string' ? e.data : '');
        };
      });

      ws.send('still alive after heartbeats');
      expect(await echoPromise).toBe('still alive after heartbeats');

      ws.close();
      await sleep(50);
    });

    it('should use Bun native ping with native strategy', async () => {
      const { adapter } = createTestAdapter();

      const wsService = createTestWsService('native-strategy');

      adapter.registerWebsocketRoute({
        path: 'native-strategy',
        middlewares: [],
        websocketService: wsService as any,
      });

      await registerRoute(adapter, {
        path: '/health',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      // native strategy: Bun handles ping/pong automatically
      await adapter.serveOptions(() => ({
        wsOptions: {
          sendPingStrategy: 'native',
          idleTimeout: 2,
          perMessageDeflate: false,
        },
      }));

      const { server: s } = await startTestServer(adapter);
      server = s;

      const ws = new WebSocket(`ws://localhost:${server.port}/native-strategy`);
      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve();
      });

      // Wait longer than idleTimeout — Bun's native sendPings should keep alive
      await sleep(3000);

      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
      await sleep(50);
    });

    it('should not send pings in adapter strategy without heartbeatInterval', async () => {
      const { adapter } = createTestAdapter();

      const wsService = createTestWsService('no-heartbeat');

      adapter.registerWebsocketRoute({
        path: 'no-heartbeat',
        middlewares: [],
        websocketService: wsService as any,
      });

      await registerRoute(adapter, {
        path: '/health',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      // adapter strategy but NO heartbeatInterval → no pings at all
      // idleTimeout: 0 so connection won't die from inactivity
      await adapter.serveOptions(() => ({
        wsOptions: {
          sendPingStrategy: 'adapter',
          idleTimeout: 0,
          perMessageDeflate: false,
        },
      }));

      const { server: s } = await startTestServer(adapter);
      server = s;

      const ws = new WebSocket(`ws://localhost:${server.port}/no-heartbeat`);
      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve();
      });

      await sleep(200);

      // Connection should be alive (idleTimeout: 0 means no timeout)
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
      await sleep(50);
    });
  });

  // ─── Shutdown ─────────────────────────────────────────────────────

  describe('Shutdown', () => {
    it('should clear intervals and tracking on shutdown', async () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      await adapter.shutdown();

      expect(logger.info).toHaveBeenCalled();
      expect(adapter.getConnectionCount('any')).toBe(0);
    });
  });

  // ─── Logger ───────────────────────────────────────────────────────

  describe('Logger', () => {
    it('should allow setting logger', () => {
      const logger1 = createMockLogger();
      const logger2 = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger1);

      adapter.logger = logger2;
      // Should use new logger
      expect(adapter['_logger']).toBe(logger2);
    });
  });
});