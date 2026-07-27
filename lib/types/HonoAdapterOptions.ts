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

  /**
   * Whether the adapter logs errors before delegating to the application's error handler.
   *
   * The adapter's line has no correlation id, so for an application that already logs in
   * its own `onError` it is pure duplication that cannot be joined with the app's own
   * entry. Set to `false` to leave observability entirely to the application.
   *
   * When enabled (the default) the level follows the status the client will see: 5xx logs
   * at ERROR with a stack, anything below logs at DEBUG (or INFO when the logger has no
   * `debug`) without one.
   *
   * @default true
   */
  logErrors?: boolean;
}
