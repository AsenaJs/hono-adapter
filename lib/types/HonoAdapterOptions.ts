import type { Hono } from 'hono';
import type { ServerLogger } from '@asenajs/asena/logger';
import type { HonoWebsocketAdapter } from '../HonoWebsocketAdapter';

export interface HonoAdapterOptions {
  /**
   * Logger instance for the adapter
   */
  logger: ServerLogger;

  /**
   * Optional pre-configured Hono app instance.
   * Use this to add custom middleware or configure Hono before Asena takes over.
   */
  app?: Hono<any, any, any>;

  /**
   * Optional custom WebSocket adapter.
   * Defaults to HonoWebsocketAdapter if not provided.
   */
  websocketAdapter?: HonoWebsocketAdapter;

  /**
   * Hono strict mode for route matching.
   * When false, `/health` and `/health/` match the same route.
   * Default: true (Hono default)
   *
   * @see https://hono.dev/docs/api/hono#strict-mode
   */
  strict?: boolean;
}
