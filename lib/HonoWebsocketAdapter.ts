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
   * Releases everything this adapter owns: heartbeat timers, connection tracking, and the
   * transport.
   *
   * The transport is the part that matters beyond a single process. `BunLocalTransport` has
   * nothing to let go of, but a remote one holds broker state - `RedisTransport` keeps a
   * subscriber connection with a live channel subscription plus a publisher - and `destroy()`
   * had no call site anywhere in the framework, so every stop leaked both. A test suite doing
   * twenty stop/start cycles, or a pod restarting under a rolling deploy, accumulates them until
   * the broker refuses new clients.
   *
   * This method does **not** close sockets, despite the name it has carried since the first
   * version. Closing them is `server.stop(closeActiveConnections)`'s job, and `HonoAdapter.stop()`
   * has already done it by the time this runs; a second pass from here would only race with Bun.
   * Called standalone, it leaves open connections alone - it just stops pinging them.
   *
   * @param timeoutMs - Ceiling for the transport teardown (default: 5000). A remote transport's
   *   `destroy()` is network I/O, and the pod being shut down is often precisely the one that
   *   cannot reach the broker - without a bound, one unreachable Redis holds the entire shutdown
   *   open indefinitely.
   */
  public async shutdown(timeoutMs = 5000): Promise<void> {
    this.logger.info('Starting WebSocket graceful shutdown...');

    // Stop all heartbeats
    this.clearAllHeartbeats();

    // Clear connection tracking
    this.activeConnections.clear();

    await this.destroyTransport(timeoutMs);

    this.logger.info('WebSocket shutdown complete');
  }

  /**
   * Runs the transport's `destroy()` under a ceiling, containing every failure.
   *
   * A transport that throws or hangs must not abort the rest of the shutdown - the same policy
   * the core applies to `@OnStop` hooks, and for the same reason: a shutdown that gives up
   * halfway leaves more behind than one that limps to the end. The timer is cleared on the happy
   * path too, so a fast teardown is not held up by a pending timeout.
   *
   * The transport reference is kept rather than cleared. Dropping it would silently downgrade a
   * restarted server to `BunLocalTransport`, and every remote `destroy()` in the ecosystem is
   * already idempotent.
   *
   * @param timeoutMs - Ceiling in milliseconds
   */
  private async destroyTransport(timeoutMs: number): Promise<void> {
    const transport = this._transport;

    if (typeof transport?.destroy !== 'function') {
      return;
    }

    let timer: Timer | undefined;

    try {
      await Promise.race([
        transport.destroy(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`WebSocket transport destroy() did not finish within ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } catch (error) {
      this.logger.error('WebSocket transport teardown failed, continuing shutdown:', error);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
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
    const namespace = rawNamespace.length > 1 && rawNamespace.endsWith('/') ? rawNamespace.slice(0, -1) : rawNamespace;

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

      // Bound at the point it is read. Pulling a method off an object and binding it two
      // statements later is the shape `unbound-method` exists to flag, and the gap is where a
      // future edit loses `this`.
      const handler = asenaWebSocketService[type]?.bind(asenaWebSocketService);

      if (!handler) {
        // Not all handlers are required, so this is not an error
        return;
      }

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
