/**
 * WebSocket Origin Middleware for Hono Adapter
 *
 * Closes the cross-site WebSocket hijacking hole by:
 * - Rejecting a handshake whose `Origin` is not allowed, before `server.upgrade()`
 * - Deciding explicitly what happens when there is no `Origin` at all
 * - Uses Hono's native header system
 *
 * @module defaults/WebSocketOriginMiddleware
 *
 * @example
 * ```typescript
 * import { Middleware, WebSocket } from '@asenajs/asena/decorators';
 * import { WebSocketOriginMiddleware } from '@asenajs/hono-adapter';
 *
 * @Middleware()
 * export class ChatOrigin extends WebSocketOriginMiddleware {
 *   constructor() {
 *     super({ allowedOrigins: ['https://app.example.com'] });
 *   }
 * }
 *
 * @WebSocket({ path: 'chat', middlewares: [ChatOrigin, SessionAuth] })
 * export class ChatSocket { ... }
 * ```
 */

import { type Context, MiddlewareService } from '../defaults';

/**
 * WebSocket origin policy options
 */
export interface WebSocketOriginOptions {
  /** Origins allowed to open a WebSocket: exact `Origin` header values, or a predicate. */
  allowedOrigins: string[] | ((origin: string) => boolean);

  /**
   * Accept handshakes that carry no `Origin` header (non-browser clients). Browsers always send one,
   * so the default rejects: a missing header is not evidence of a first-party page.
   *
   * @default false
   */
  allowMissingOrigin?: boolean;
}

/**
 * WebSocket Origin Middleware
 *
 * Use it as a `@WebSocket({ middlewares: [...] })` middleware, listed **before** any cookie-based
 * auth middleware: the browser attaches cookies to a cross-site handshake, so a session is already
 * authenticated by the time an auth middleware looks at it.
 *
 * `CorsMiddleware` is not a WebSocket origin policy - it sets response headers a browser applies to
 * `fetch`/XHR, and a disallowed origin still upgrades.
 *
 * The `Origin` header is compared exactly: `'https://app.example.com'`, scheme included, no trailing
 * slash.
 *
 * It is an ordinary middleware, so on an HTTP route it would reject every request without an
 * `Origin` - which is why the name says WebSocket.
 *
 * @example
 * ```typescript
 * // A predicate covers wildcard subdomains; there is no '*' special value
 * new WebSocketOriginMiddleware({ allowedOrigins: (origin) => origin.endsWith('.example.com') });
 * ```
 */
export class WebSocketOriginMiddleware extends MiddlewareService {
  private readonly allowedOrigins: string[] | ((origin: string) => boolean);

  private readonly allowMissingOrigin: boolean;

  /**
   * Creates a new WebSocket origin middleware instance
   *
   * @param options - Origin policy options
   */
  public constructor(options: WebSocketOriginOptions) {
    super();

    this.allowedOrigins = options.allowedOrigins;
    this.allowMissingOrigin = options.allowMissingOrigin ?? false;
  }

  /**
   * Reject the handshake unless its `Origin` is allowed
   *
   * @param context - Hono context wrapper
   * @param next - Function to call next middleware or handler
   * @returns A 403 response, or the result of next() for an allowed origin
   */
  public async handle(context: Context, next: () => Promise<void>): Promise<any> {
    const origin = context.req.header('Origin');

    if (!origin) {
      return this.allowMissingOrigin ? await next() : new Response('Forbidden', { status: 403 });
    }

    const allowed = Array.isArray(this.allowedOrigins)
      ? this.allowedOrigins.includes(origin)
      : this.allowedOrigins(origin);

    return allowed ? await next() : new Response('Forbidden', { status: 403 });
  }
}
