import { AsenaWebsocketAdapter } from '@asenajs/asena/adapter';
import type { Server, ServerWebSocket } from 'bun';
import type { AsenaWebSocketService } from '@asenajs/asena/web-socket';
import {
  AsenaSocket,
  AsenaWebSocketServer,
  BunLocalTransport,
  type WebSocketData,
  type WSEvents,
  type WSOptions,
} from '@asenajs/asena/web-socket';
import type { ServerLogger } from '@asenajs/asena/logger';

export class HonoWebsocketAdapter extends AsenaWebsocketAdapter {
  public name = 'HonoWebsocketAdapter';

  private activeConnections: Map<string, Set<string>> = new Map(); // namespace -> Set of connection IDs

  private connectionLimits: Map<string, number> = new Map(); // namespace -> max connections

  public constructor(logger: ServerLogger) {
    super(logger);
  }

  /**
   * Sets maximum connections allowed per namespace
   * @param namespace - WebSocket namespace
   * @param limit - Maximum number of concurrent connections
   */
  public setConnectionLimit(namespace: string, limit: number): void {
    if (limit < 1) {
      throw new Error('Connection limit must be at least 1');
    }

    this.connectionLimits.set(namespace, limit);
    this.logger.info(`Connection limit set for namespace "${namespace}": ${limit}`);
  }

  /**
   * Gets active connection count for a namespace
   * @param namespace - WebSocket namespace
   * @returns Number of active connections
   */
  public getConnectionCount(namespace: string): number {
    return this.activeConnections.get(namespace)?.size || 0;
  }

  /**
   * Graceful shutdown - closes all connections
   * @param _timeoutMs - Timeout for graceful shutdown (default: 5000)
   */
  public async shutdown(_timeoutMs = 5000): Promise<void> {
    this.logger.info('Starting WebSocket graceful shutdown...');

    // Stop all heartbeats
    this.clearAllHeartbeats();

    // Clear connection tracking
    this.activeConnections.clear();

    this.logger.info('WebSocket shutdown complete');
  }

  public registerWebSocket(webSocketService: AsenaWebSocketService<any>): void {
    if (!webSocketService) {
      throw new Error('WebSocket service is required');
    }

    const rawNamespace = webSocketService.namespace;

    if (!rawNamespace) {
      throw new Error('WebSocket namespace is required');
    }

    // Normalize namespace: strip trailing slash for consistent lookup
    const namespace = rawNamespace.length > 1 && rawNamespace.endsWith('/')
      ? rawNamespace.slice(0, -1)
      : rawNamespace;

    // Validate namespace format (alphanumeric, hyphens, underscores, slashes)
    if (!/^[a-zA-Z0-9\-_/]+$/.exec(namespace)) {
      throw new Error(
        `Invalid WebSocket namespace format: "${namespace}". Only alphanumeric characters, hyphens, underscores, and slashes are allowed.`,
      );
    }

    // Initialize websockets map if needed
    if (this.websockets === undefined) {
      this.websockets = new Map<string, AsenaWebSocketService<any>>();
    }

    // Check for duplicate registration
    if (this.websockets.has(namespace)) {
      this.logger.warn(
        `WebSocket namespace "${namespace}" is already registered. Overwriting previous registration...`,
      );
    }

    this.websockets.set(namespace, webSocketService);
  }

  /**
   * Starts WebSocket server and initializes a single shared AsenaWebSocketServer
   * All WebSocket services share the same wrapper instance for efficiency
   * @param server - Bun Server instance
   */
  public async startWebsocket(server: Server<WebSocketData>): Promise<void> {
    if (!this.websockets || this.websockets.size < 1) {
      return;
    }

    // Initialize transport (default: BunLocalTransport)
    const transport = this._transport ?? new BunLocalTransport();

    await transport.init?.(server);

    // Create a single shared wrapper for all WebSocket services
    const sharedServer = new AsenaWebSocketServer(transport);

    // Assign the shared wrapper to all services
    for (const websocket of this.websockets.values()) {
      websocket.server = sharedServer;
    }
  }

  public prepareWebSocket(options?: WSOptions): void {
    if (this.websockets?.size < 1) {
      return;
    }

    const strategy = options?.sendPingStrategy ?? 'adapter';
    // Heartbeat is only used in adapter strategy
    const heartbeatInterval = strategy === 'adapter' ? options?.heartbeatInterval : undefined;

    // Separate strategy/heartbeat fields from WSOptions to avoid conflicts
    const {
      sendPings: _sendPings,
      sendPingStrategy: _strategy,
      heartbeatInterval: _hbInterval,
      ...restOptions
    } = options ?? ({} as any);

    this.websocket = {
      // Strategy controls sendPings:
      //   'adapter' → false (Bun native disabled, adapter handles keepalive)
      //   'native'  → true  (Bun native handles ping/pong)
      // See: https://github.com/oven-sh/bun/issues/26554
      sendPings: strategy === 'native',

      open: (ws: ServerWebSocket<WebSocketData>) => {
        const namespace = ws.data.path;

        // Check connection limit
        const limit = this.connectionLimits.get(namespace);
        const currentCount = this.getConnectionCount(namespace);

        if (limit && currentCount >= limit) {
          this.logger.warn(
            `Connection limit reached for namespace "${namespace}": ${currentCount}/${limit}. Rejecting new connection.`,
          );

          ws.close(1008, 'Connection limit reached');

          return;
        }

        // Track connection
        if (!this.activeConnections.has(namespace)) {
          this.activeConnections.set(namespace, new Set());
        }

        this.activeConnections.get(namespace).add(ws.data.id);

        // Start heartbeat if enabled (adapter strategy only)
        if (heartbeatInterval) {
          this.startHeartbeat(ws, heartbeatInterval);
        }

        this.logger.info(
          `WebSocket opened: ${ws.data.id} on namespace "${namespace}" (${currentCount + 1} active connections)`,
        );

        // Call user handler
        this.createHandler('onOpenInternal')(ws);
      },

      close: (ws: ServerWebSocket<WebSocketData>, code: number, reason: string) => {
        const namespace = ws.data.path;

        // Stop heartbeat
        this.stopHeartbeat(ws.data.id);

        // Remove from tracking
        this.activeConnections.get(namespace)?.delete(ws.data.id);

        const remainingCount = this.getConnectionCount(namespace);

        this.logger.info(
          `WebSocket closed: ${ws.data.id} on namespace "${namespace}" (${remainingCount} remaining connections)`,
        );

        // Call user handler
        this.createHandler('onCloseInternal')(ws, code, reason);
      },

      message: this.createHandler('onMessage'),
      drain: this.createHandler('onDrain'),
      ping: this.createHandler('onPing'),
      pong: this.createHandler('onPong'),
      ...restOptions,
    };
  }

  private createHandler(type: keyof WSEvents) {
    return async (ws: ServerWebSocket<WebSocketData>, ...args: any[]) => {
      const asenaWebSocketService = this.websockets.get(ws.data.path);

      if (!asenaWebSocketService) {
        this.logger.error(`WebSocket handler not found for path: ${ws.data.path}`);
        // Close connection with error code if handler not found
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1011, 'Internal server error: handler not found');
        }

        return;
      }

      let handler = asenaWebSocketService[type];

      if (!handler) {
        // Not all handlers are required, so this is not an error
        return;
      }

      handler = handler.bind(asenaWebSocketService);

      try {
        await (handler as (socket: AsenaSocket<WebSocketData>, ...args: any[]) => void | Promise<void>)(
          new AsenaSocket(ws, asenaWebSocketService.namespace, this._transport),
          ...args,
        );
      } catch (error) {
        this.logger.error(`WebSocket ${type} handler error for path ${ws.data.path}:`, {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          socketId: ws.data.id,
          path: ws.data.path,
        });

        // Try to send error to client if connection is still open
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(
              JSON.stringify({
                type: 'error',
                message: 'Server error occurred',
                timestamp: new Date().toISOString(),
              }),
            );
          } catch (sendError) {
            this.logger.error('Failed to send error message to client:', sendError);
          }
        }

        // For critical errors, close connection gracefully
        if (type === 'onOpenInternal' || type === 'onMessage') {
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1011, 'Handler error');
          }
        }
      }
    };
  }
}
