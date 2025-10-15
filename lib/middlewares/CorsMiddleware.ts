/**
 * CORS Middleware for Hono Adapter
 *
 * Handles Cross-Origin Resource Sharing (CORS) by:
 * - Setting appropriate CORS headers on responses
 * - Handling preflight OPTIONS requests
 * - Supporting origin validation
 * - Uses Hono's native header system
 *
 * @module defaults/CorsMiddleware
 *
 * @example
 * ```typescript
 * import { Middleware } from '@asenajs/asena/server';
 * import { CorsMiddleware } from '@asenajs/hono-adapter';
 *
 * @Middleware()
 * export class MyCorsMiddleware extends CorsMiddleware {
 *   constructor() {
 *     super({
 *       origin: '*', // or ['https://example.com']
 *       methods: ['GET', 'POST', 'PUT', 'DELETE'],
 *       credentials: true
 *     });
 *   }
 * }
 * ```
 */

import { type Context, MiddlewareService } from '../defaults';

/**
 * CORS configuration options
 */
export interface CorsOptions {
  /**
   * Allowed origins
   * - Use '*' to allow all origins
   * - Use string to allow a single specific origin
   * - Use string[] to allow specific origins
   * - Use function for dynamic origin validation
   *
   * @default '*'
   */
  origin?: '*' | string | string[] | ((origin: string) => boolean);

  /**
   * Allowed HTTP methods
   *
   * @default ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
   */
  methods?: string[];

  /**
   * Allowed headers
   *
   * @default ['Content-Type', 'Authorization']
   */
  allowedHeaders?: string[];

  /**
   * Exposed headers (visible to client JavaScript)
   *
   * @default []
   */
  exposedHeaders?: string[];

  /**
   * Allow credentials (cookies, authorization headers, TLS client certificates)
   *
   * @default false
   */
  credentials?: boolean;

  /**
   * Preflight cache duration in seconds
   *
   * @default 86400 (24 hours)
   */
  maxAge?: number;
}

/**
 * CORS Middleware
 *
 * Implements CORS (Cross-Origin Resource Sharing) for Hono adapter.
 * Extend this class and configure it via constructor to customize CORS behavior.
 *
 * **Performance Optimizations:**
 * - Lazy header allocation (only when needed)
 * - Pre-joined header strings for common cases
 * - Fast origin validation
 * - Minimal string allocations
 *
 * **CORS Flow:**
 * 1. Check if request has Origin header (if not, skip CORS)
 * 2. Validate origin against allowed origins
 * 3. Handle preflight OPTIONS request → return 204 immediately
 * 4. For other requests → set CORS headers and call next()
 */
export class CorsMiddleware extends MiddlewareService {

  private readonly origin: '*' | string | string[] | ((origin: string) => boolean);

  private readonly methods: string;

  private readonly allowedHeaders: string;

  private readonly exposedHeaders: string;

  private readonly credentials: boolean;

  private readonly maxAge: string;

  /**
   * Creates a new CORS middleware instance
   *
   * @param options - CORS configuration options
   *
   * @example
   * ```typescript
   * @Middleware()
   * export class CustomCors extends CorsMiddleware {
   *   constructor() {
   *     super({
   *       origin: ['https://example.com', 'https://app.example.com'],
   *       methods: ['GET', 'POST'],
   *       credentials: true,
   *       maxAge: 3600
   *     });
   *   }
   * }
   * ```
   */
  public constructor(options: CorsOptions = {}) {
    super();

    // Pre-process and store configuration (avoid runtime processing)
    this.origin = options.origin ?? '*';
    this.methods = (options.methods ?? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']).join(', ');
    this.allowedHeaders = (options.allowedHeaders ?? ['Content-Type', 'Authorization']).join(', ');
    this.exposedHeaders = (options.exposedHeaders ?? []).join(', ');
    this.credentials = options.credentials ?? false;
    this.maxAge = String(options.maxAge ?? 86400); // 24 hours default
  }

  /**
   * CORS middleware handler
   *
   * Execution flow:
   * 1. Check if Origin header present (if not, skip CORS)
   * 2. Validate origin
   * 3. Handle preflight OPTIONS → return 204 No Content
   * 4. Set CORS headers for actual request → call next()
   *
   * @param context - Hono context wrapper
   * @param next - Function to call next middleware or handler
   * @returns Response for preflight, or result of next() for actual requests
   */
  public async handle(context: Context, next: () => Promise<void>): Promise<any> {
    const origin = context.req.header('Origin');

    // If no Origin header, this is not a CORS request → skip
    if (!origin) {
      return await next();
    }

    // Validate origin
    const allowedOrigin = this.getAllowedOrigin(origin);

    if (!allowedOrigin) {
      // Origin not allowed → block request
      return new Response('CORS: Origin not allowed', { status: 403 });
    }

    // Set CORS headers using Hono's context (access via context.context for HonoContextWrapper)
    const honoContext = (context as any).context;

    honoContext.header('Access-Control-Allow-Origin', allowedOrigin);

    if (this.credentials) {
      honoContext.header('Access-Control-Allow-Credentials', 'true');
    }

    if (this.exposedHeaders) {
      honoContext.header('Access-Control-Expose-Headers', this.exposedHeaders);
    }

    // Handle preflight OPTIONS request
    if (context.req.method === 'OPTIONS') {
      // Build headers object for preflight response
      const headers: Record<string, string> = {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': this.methods,
        'Access-Control-Allow-Headers': this.allowedHeaders,
        'Access-Control-Max-Age': this.maxAge,
      };

      if (this.credentials) {
        headers['Access-Control-Allow-Credentials'] = 'true';
      }

      // Return 204 No Content for preflight
      return new Response(null, { status: 204, headers });
    }

    // For actual requests, continue to handler
    return await next();
  }

  /**
   * Determines the allowed origin value for the response
   *
   * Performance:
   * - Fast path for '*' (most common case)
   * - String comparison for single origin
   * - Array.includes() for string array (O(n) but n is typically small)
   * - Function call for dynamic validation
   *
   * @param requestOrigin - Origin from request header
   * @returns Allowed origin string or null if not allowed
   */
  private getAllowedOrigin(requestOrigin: string): string | null {
    // Fast path: Allow all origins
    if (this.origin === '*') {
      return '*';
    }

    // Single origin string
    if (typeof this.origin === 'string') {
      return this.origin === requestOrigin ? requestOrigin : null;
    }

    // Array of specific origins
    if (Array.isArray(this.origin)) {
      return this.origin.includes(requestOrigin) ? requestOrigin : null;
    }

    // Function-based validation
    if (typeof this.origin === 'function') {
      return this.origin(requestOrigin) ? requestOrigin : null;
    }

    return null;
  }

}
