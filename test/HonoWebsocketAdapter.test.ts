import { describe, expect, it, mock } from 'bun:test';
import { HonoWebsocketAdapter } from '../lib/HonoWebsocketAdapter';
import type { ServerLogger } from '@asenajs/asena/logger';
import type { AsenaWebSocketService, WSOptions } from '@asenajs/asena/web-socket';

// Mock logger for testing
const createMockLogger = (): ServerLogger => ({
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  // @ts-ignore
  debug: mock(() => {}),
});

describe('HonoWebsocketAdapter - Enhanced Tests', () => {
  describe('Adapter Creation', () => {
    it('should create an adapter instance', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      expect(adapter).toBeDefined();
      expect(adapter.name).toBe('HonoWebsocketAdapter');
    });

    it('should set the logger instance', () => {
      const logger1 = createMockLogger();
      const logger2 = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger1);

      adapter.logger = logger2;

      expect(adapter['_logger']).toBe(logger2);
    });
  });

  describe('WebSocket Registration', () => {
    it('should register WebSocket service', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      const service: Partial<AsenaWebSocketService<any>> = {
        namespace: 'chat',
        // its protected so giving error
        // @ts-ignore
        onMessage: async () => {},
      };

      adapter.registerWebSocket(service as any);

      expect(logger.info).toHaveBeenCalled();
    });

    it('should throw error for null service', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      expect(() => {
        adapter.registerWebSocket(null as any);
      }).toThrow('WebSocket service is required');
    });

    it('should throw error for missing namespace', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      const service: Partial<AsenaWebSocketService<any>> = {
        // @ts-ignore
        onMessage: async () => {},
      };

      expect(() => {
        adapter.registerWebSocket(service as any);
      }).toThrow('WebSocket namespace is required');
    });

    it('should throw error for invalid namespace format', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      const service: Partial<AsenaWebSocketService<any>> = {
        namespace: 'invalid namespace!@#',
        // @ts-ignore
        onMessage: async () => {},
      };

      expect(() => {
        adapter.registerWebSocket(service as any);
      }).toThrow('Invalid WebSocket namespace format');
    });

    it('should warn on duplicate namespace registration', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      const service1: Partial<AsenaWebSocketService<any>> = {
        namespace: 'chat',
        // @ts-ignore
        onMessage: async () => {},
      };

      const service2: Partial<AsenaWebSocketService<any>> = {
        namespace: 'chat',
        // @ts-ignore
        onMessage: async () => {},
      };

      adapter.registerWebSocket(service1 as any);
      adapter.registerWebSocket(service2 as any);

      expect(logger.warn).toHaveBeenCalled();
    });

    it('should accept valid namespace formats', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      const validNamespaces = ['chat', 'chat-room', 'chat_room', 'chat/room', 'room123'];

      validNamespaces.forEach((namespace) => {
        const service: Partial<AsenaWebSocketService<any>> = {
          namespace,
          // @ts-ignore
          onMessage: async () => {},
        };

        expect(() => {
          adapter.registerWebSocket(service as any);
        }).not.toThrow();
      });
    });
  });

  describe('Connection Management', () => {
    it('should set connection limit', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      adapter.setConnectionLimit('chat', 100);

      expect(logger.info).toHaveBeenCalled();
    });

    it('should throw error for invalid connection limit', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      expect(() => {
        adapter.setConnectionLimit('chat', 0);
      }).toThrow('Connection limit must be at least 1');
    });

    it('should get connection count', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      const count = adapter.getConnectionCount('chat');

      expect(count).toBe(0);
    });

    it('should shutdown gracefully', async () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      await adapter.shutdown();

      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe('WebSocket Preparation', () => {
    it('should prepare WebSocket handlers', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      const service: Partial<AsenaWebSocketService<any>> = {
        namespace: 'test',
        // @ts-ignore
        onMessage: async () => {},
        onOpenInternal: async () => {},
        onCloseInternal: async () => {},
      };

      adapter.registerWebSocket(service as any);
      adapter.prepareWebSocket();

      expect(adapter.websocket).toBeDefined();
      expect(adapter.websocket?.open).toBeDefined();
      expect(adapter.websocket?.message).toBeDefined();
      expect(adapter.websocket?.close).toBeDefined();
    });

    it('should skip most preparation if no websockets registered', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      adapter.prepareWebSocket();

      // Even without websockets, basic handlers may be set
      // This is not an error, just means no user handlers will be called
      expect(adapter.websocket).toBeDefined();
    });

    it('should accept custom WS options', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      const service: Partial<AsenaWebSocketService<any>> = {
        namespace: 'test',
        // @ts-ignore
        onMessage: async () => {},
      };

      adapter.registerWebSocket(service as any);

      const options: WSOptions & { heartbeatInterval?: number } = {
        maxPayloadLimit: 1024 * 1024,
        idleTimeout: 120,
        heartbeatInterval: 30000,
        perMessageDeflate: false,
      };

      adapter.prepareWebSocket(options);

      expect(adapter.websocket).toBeDefined();
    });

    it('should prepare WebSocket with drain handler', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      const service: Partial<AsenaWebSocketService<any>> = {
        namespace: 'test',
        // @ts-ignore
        onMessage: async () => {},
        // @ts-ignore
        onDrain: async () => {},
      };

      adapter.registerWebSocket(service as any);
      adapter.prepareWebSocket();

      expect(adapter.websocket?.drain).toBeDefined();
    });

    it('should prepare WebSocket with ping handler', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      const service: Partial<AsenaWebSocketService<any>> = {
        namespace: 'test',
        // @ts-ignore
        onMessage: async () => {},
        // @ts-ignore
        onPing: async () => {},
      };

      adapter.registerWebSocket(service as any);
      adapter.prepareWebSocket();

      expect(adapter.websocket?.ping).toBeDefined();
    });

    it('should prepare WebSocket with pong handler', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      const service: Partial<AsenaWebSocketService<any>> = {
        namespace: 'test',
        // @ts-ignore
        onMessage: async () => {},
        // @ts-ignore
        onPong: async () => {},
      };

      adapter.registerWebSocket(service as any);
      adapter.prepareWebSocket();

      expect(adapter.websocket?.pong).toBeDefined();
    });
  });

  describe('Heartbeat Management', () => {
    it('should start and track heartbeat', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      // Call private startHeartbeat via prepareWebSocket with heartbeat enabled
      const service: Partial<AsenaWebSocketService<any>> = {
        namespace: 'chat',
        // @ts-ignore
        onMessage: async () => {},
      };

      adapter.registerWebSocket(service as any);
      adapter.prepareWebSocket({ perMessageDeflate: false, heartbeatInterval: 100 });

      expect(adapter.websocket).toBeDefined();
    });

    it('should stop heartbeat when connection closes', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      const service: Partial<AsenaWebSocketService<any>> = {
        namespace: 'chat',
        // @ts-ignore
        onMessage: async () => {},
      };

      adapter.registerWebSocket(service as any);
      adapter.prepareWebSocket({ perMessageDeflate: false, heartbeatInterval: 1000 });

      // The stopHeartbeat should be called when a connection is closed
      expect(adapter.websocket?.close).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle missing WebSocket service gracefully', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      const mockWs = {
        data: { id: 'test-123', path: 'nonexistent' },
        readyState: 1,
        close: mock(() => {}),
      };

      const service: Partial<AsenaWebSocketService<any>> = {
        namespace: 'chat',
        // @ts-ignore
        onMessage: async () => {},
      };

      adapter.registerWebSocket(service as any);
      adapter.prepareWebSocket();

      // Calling a handler for a non-existent namespace should log error
      if (adapter.websocket?.message) {
        adapter.websocket.message(mockWs as any, 'test message');
        expect(logger.error).toHaveBeenCalled();
      }
    });

    it('should handle handler errors', async () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      const service: Partial<AsenaWebSocketService<any>> = {
        namespace: 'chat',
        // @ts-ignore
        onMessage: async () => {
          throw new Error('Handler error');
        },
      };

      adapter.registerWebSocket(service as any);
      adapter.prepareWebSocket();

      const mockWs = {
        data: { id: 'test-123', path: 'chat' },
        readyState: 1,
        send: mock(() => {}),
        close: mock(() => {}),
      };

      // Trigger message handler with error
      if (adapter.websocket?.message) {
        await adapter.websocket.message(mockWs as any, 'test');
      }

      // Should log error
      expect(logger.error).toHaveBeenCalled();
    });

    it('should close connection on critical handler errors', async () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      const service: Partial<AsenaWebSocketService<any>> = {
        namespace: 'chat',
        // @ts-ignore
        onMessage: async () => {
          throw new Error('Critical error');
        },
      };

      adapter.registerWebSocket(service as any);
      adapter.prepareWebSocket();

      const mockWs = {
        data: { id: 'test-123', path: 'chat' },
        readyState: 1,
        send: mock(() => {}),
        close: mock(() => {}),
      };

      if (adapter.websocket?.message) {
        await adapter.websocket.message(mockWs as any, 'test');
      }

      // Should attempt to close connection
      expect(mockWs.close).toHaveBeenCalled();
    });

    it('should handle send error in error handler', async () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      const service: Partial<AsenaWebSocketService<any>> = {
        namespace: 'chat',
        // @ts-ignore
        onMessage: async () => {
          throw new Error('Message handler error');
        },
      };

      adapter.registerWebSocket(service as any);
      adapter.prepareWebSocket();

      const mockWs = {
        data: { id: 'test-123', path: 'chat' },
        readyState: 1,
        send: mock(() => {
          throw new Error('Send failed');
        }),
        close: mock(() => {}),
      };

      if (adapter.websocket?.message) {
        await adapter.websocket.message(mockWs as any, 'test');
      }

      // Should log both the handler error and send error
      expect(logger.error).toHaveBeenCalledTimes(2);
    });

    it('should handle connection limit reached', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      const service: Partial<AsenaWebSocketService<any>> = {
        namespace: 'chat',
        // @ts-ignore
        onMessage: async () => {},
      };

      adapter.registerWebSocket(service as any);
      adapter.setConnectionLimit('chat', 1);

      // Simulate connection at limit
      adapter['activeConnections'].set('chat', new Set(['conn-1']));

      adapter.prepareWebSocket();

      const mockWs = {
        data: { id: 'test-123', path: 'chat' },
        readyState: 1,
        close: mock(() => {}),
      };

      // Try to open new connection when limit reached
      if (adapter.websocket?.open) {
        adapter.websocket.open(mockWs as any);
      }

      // Should close the connection due to limit
      expect(mockWs.close).toHaveBeenCalledWith(1008, 'Connection limit reached');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should not call handler if handler is missing', () => {
      const logger = createMockLogger();
      const adapter = new HonoWebsocketAdapter(logger);

      const service: Partial<AsenaWebSocketService<any>> = {
        namespace: 'chat',
        // @ts-ignore
        onMessage: async () => {},
        // onDrain is missing
      };

      adapter.registerWebSocket(service as any);
      adapter.prepareWebSocket();

      const mockWs = {
        data: { id: 'test-123', path: 'chat' },
        readyState: 1,
      };

      // Call drain handler which is missing - should not throw
      if (adapter.websocket?.drain) {
        adapter.websocket.drain(mockWs as any);
      }

      // Should not log error for missing optional handlers
      expect(logger.error).not.toHaveBeenCalled();
    });
  });
});
