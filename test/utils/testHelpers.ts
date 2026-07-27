import { mock } from 'bun:test';
import { HonoAdapter } from '../../lib/HonoAdapter';
import { HonoWebsocketAdapter } from '../../lib/HonoWebsocketAdapter';
import type { ServerLogger } from '@asenajs/asena/logger';
import type { BaseMiddleware } from '@asenajs/asena/adapter';
import type { Context as HonoAdapterContext } from '../../lib/defaults';
import { HttpMethod } from '@asenajs/asena/web-types';
import type { HonoAdapterOptions } from '../../lib/types';

/**
 * Creates a mock ServerLogger with all methods as mock functions.
 * This is the ONLY mock we use in the entire test suite.
 */
export function createMockLogger(): ServerLogger {
  return {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    profile: mock(() => {}),
  };
}

/**
 * Creates a test HonoAdapter with mock logger and port 0 (random available port).
 */
export function createTestAdapter(opts?: Partial<HonoAdapterOptions>) {
  const logger = opts?.logger ?? createMockLogger();
  const wsAdapter = opts?.websocketAdapter ?? new HonoWebsocketAdapter(logger);

  const adapter = new HonoAdapter({
    logger,
    websocketAdapter: wsAdapter,
    app: opts?.app,
    strict: opts?.strict ?? false,
  });

  adapter.setPort(0);

  return { adapter, logger, wsAdapter };
}

/**
 * Starts the adapter server and returns connection info.
 */
export async function startTestServer(adapter: HonoAdapter) {
  const server = await adapter.start();
  const port = server.port;
  const baseUrl = `http://localhost:${port}`;

  return { server, port, baseUrl };
}

/**
 * Shortcut for registering a route with sensible defaults.
 */
export async function registerRoute(
  adapter: HonoAdapter,
  overrides: {
    method?: HttpMethod;
    path?: string;
    handler?: (ctx: HonoAdapterContext) => any;
    middlewares?: BaseMiddleware<HonoAdapterContext>[];
    staticServe?: any;
    validator?: any;
    controllerName?: string;
    controllerBasePath?: string;
  },
) {
  await adapter.registerRoute({
    method: overrides.method ?? HttpMethod.GET,
    path: overrides.path ?? '/test',
    handler: overrides.handler ?? ((ctx: HonoAdapterContext) => ctx.send({ ok: true })),
    middlewares: overrides.middlewares ?? [],
    staticServe: overrides.staticServe ?? null,
    validator: overrides.validator ?? null,
    controllerName: overrides.controllerName,
    controllerBasePath: overrides.controllerBasePath,
  } as any);
}

/**
 * Creates a BaseMiddleware with configurable behavior.
 *
 * @param behavior - What the middleware does:
 *   - 'next' (default): calls next() and returns true
 *   - 'block': returns false to stop the chain
 *   - 'response': returns a Response object
 *   - 'throw': throws an error
 *   - 'setHeader': sets a response header then calls next()
 *   - Function: custom behavior
 */
export function createTestMiddleware(
  behavior:
    | 'next'
    | 'block'
    | 'response'
    | 'throw'
    | 'setHeader'
    | ((ctx: HonoAdapterContext, next: () => Promise<void>) => any) = 'next',
  options?: { headerName?: string; headerValue?: string; override?: boolean },
): BaseMiddleware<HonoAdapterContext> {
  let handleFn: (ctx: HonoAdapterContext, next: () => Promise<void>) => any;

  switch (behavior) {
    case 'next':
      handleFn = async (_ctx, next) => {
        await next();
        return true;
      };
      break;
    case 'block':
      handleFn = async () => false;
      break;
    case 'response':
      handleFn = async () => new Response(JSON.stringify({ blocked: true }), { status: 403 });
      break;
    case 'throw':
      handleFn = async () => {
        throw new Error('Middleware error');
      };
      break;
    case 'setHeader':
      handleFn = async (ctx, next) => {
        ctx.setResponseHeader?.(options?.headerName ?? 'X-Test-Middleware', options?.headerValue ?? 'applied');
        await next();
        return true;
      };
      break;
    default:
      handleFn = behavior;
      break;
  }

  return {
    handle: mock(handleFn),
    override: options?.override ?? false,
  };
}

/**
 * Waits for a specified number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
