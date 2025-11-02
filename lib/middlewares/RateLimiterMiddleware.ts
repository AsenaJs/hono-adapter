/**
 * Rate Limiter Middleware for Hono Adapter
 *
 * Implements Token Bucket algorithm for rate limiting:
 * - Token bucket per client (identified by IP or custom key)
 * - Configurable capacity and refill rate
 * - Instance-based storage (each middleware instance has its own buckets)
 * - Zero external dependencies (uses Bun's native APIs)
 * - Asena DI container compatible
 *
 * @module defaults/RateLimiterMiddleware
 *
 * **Usage in Asena Application:**
 * ```typescript
 * import { Middleware } from '@asenajs/asena/server';
 * import { RateLimiterMiddleware } from '@asenajs/hono-adapter';
 *
 * // Create custom rate limiter for your needs
 * @Middleware()
 * export class ApiRateLimiter extends RateLimiterMiddleware {
 *   constructor() {
 *     super({
 *       capacity: 100,
 *       refillRate: 100 / 60, // 100 requests per minute
 *     });
 *   }
 * }
 *
 * // Use in controller (class reference, not instance)
 * @Controller({ middlewares: [ApiRateLimiter] })
 * export class ApiController { ... }
 *
 * // Or use on specific route
 * @Middleware()
 * export class StrictRateLimiter extends RateLimiterMiddleware {
 *   constructor() {
 *     super({
 *       capacity: 5,
 *       refillRate: 5 / 60, // 5 requests per minute
 *       message: 'Too many login attempts. Please try again later.',
 *     });
 *   }
 * }
 *
 * @Post({ path: '/login', middlewares: [StrictRateLimiter] })
 * public login() { ... }
 * ```
 */

import { type Context, MiddlewareService } from '../defaults';

/**
 * Token bucket for a single client
 */
interface Bucket {
  /**
   * Current number of tokens available
   */
  tokens: number;

  /**
   * Last refill timestamp (milliseconds)
   */
  lastRefill: number;
}

/**
 * Rate limiter configuration options
 */
export interface RateLimiterOptions {
  /**
   * Maximum token capacity (burst size)
   *
   * This defines how many requests can be made in a burst.
   * Example: capacity = 100 means 100 requests can be made instantly if bucket is full.
   *
   * @default 100
   */
  capacity?: number;

  /**
   * Token refill rate (tokens per second)
   *
   * This defines the sustained request rate.
   * Example: refillRate = 10 means 10 requests per second sustained rate.
   *
   * Common patterns:
   * - 10 req/s → refillRate: 10
   * - 100 req/min → refillRate: 100/60 ≈ 1.67
   * - 1000 req/hour → refillRate: 1000/3600 ≈ 0.28
   *
   * @default 10
   */
  refillRate?: number;

  /**
   * Custom key generator function
   *
   * By default, uses IP address from X-Forwarded-For header or CF-Connecting-IP.
   * You can customize this to use user ID, API key, or any other identifier.
   *
   * @default (ctx) => ctx.req.headers.get('x-forwarded-for') || ctx.req.headers.get('cf-connecting-ip') || 'unknown'
   *
   * @example
   * ```typescript
   * // Rate limit by user ID
   * keyGenerator: (ctx) => ctx.getValue('user')?.id || 'anonymous'
   *
   * // Rate limit by API key
   * keyGenerator: (ctx) => ctx.req.headers.get('x-api-key') || 'unknown'
   * ```
   */
  keyGenerator?: (context: Context) => string;

  /**
   * Custom message for rate limit exceeded response
   *
   * @default 'Rate limit exceeded. Please try again later.'
   */
  message?: string;

  /**
   * HTTP status code for rate limit exceeded response
   *
   * @default 429
   */
  statusCode?: number;

  /**
   * Token cost per request
   *
   * Advanced feature: Different endpoints can cost different amounts of tokens.
   *
   * @default 1
   *
   * @example
   * ```typescript
   * // Expensive operations cost more tokens
   * cost: (ctx) => ctx.req.url.includes('/search') ? 5 : 1
   * ```
   */
  cost?: number | ((context: Context) => number);

  /**
   * Skip rate limiting based on context
   *
   * Useful for whitelisting certain IPs, paths, or authenticated users.
   *
   * @default undefined
   *
   * @example
   * ```typescript
   * // Skip rate limiting for health check
   * skip: (ctx) => ctx.req.url === '/health'
   *
   * // Skip for admin users
   * skip: (ctx) => ctx.getValue('user')?.role === 'admin'
   * ```
   */
  skip?: (context: Context) => boolean;

  /**
   * Bucket cleanup interval in milliseconds
   *
   * Periodically removes inactive buckets to prevent memory leaks.
   * Set to 0 to disable automatic cleanup.
   *
   * @default 60000 (1 minute)
   */
  cleanupInterval?: number;

  /**
   * Bucket TTL (time to live) in milliseconds
   *
   * Buckets that haven't been accessed for this duration will be removed during cleanup.
   *
   * @default 600000 (10 minutes)
   */
  bucketTTL?: number;
}

/**
 * Rate Limiter Middleware
 *
 * Implements Token Bucket algorithm for controlling request rate.
 * Each middleware instance maintains its own bucket storage (instance-based strategy).
 *
 * **Token Bucket Algorithm:**
 * 1. Each client has a bucket with a maximum capacity of tokens
 * 2. Tokens refill at a constant rate (refillRate per second)
 * 3. Each request consumes tokens (default: 1 token)
 * 4. If bucket has insufficient tokens → 429 Too Many Requests
 * 5. Bucket capacity never exceeds maximum (tokens don't accumulate indefinitely)
 *
 * **Performance Optimizations:**
 * - O(1) bucket lookup (Map)
 * - O(1) token calculation (pure math, no arrays)
 * - Lazy token refill (calculated on-demand, not via setInterval)
 * - Memory-efficient bucket structure (2 numbers per client)
 * - Automatic cleanup of inactive buckets
 *
 * **Instance-based Strategy:**
 * Each RateLimiterMiddleware instance has its own bucket Map.
 * This enables route-specific rate limiting:
 * - GlobalRateLimiter → 1000 req/min for all routes
 * - ApiRateLimiter → 100 req/min for /api/* routes
 * - StrictRateLimiter → 5 req/min for /login route
 *
 * @example
 * ```typescript
 * // Global rate limiter (1000 req/min)
 * @Middleware()
 * export class GlobalRateLimiter extends RateLimiterMiddleware {
 *   constructor() {
 *     super({ capacity: 1000, refillRate: 1000/60 });
 *   }
 * }
 *
 * // Strict rate limiter for auth endpoints (5 req/min)
 * @Middleware()
 * export class StrictRateLimiter extends RateLimiterMiddleware {
 *   constructor() {
 *     super({ capacity: 5, refillRate: 5/60 });
 *   }
 * }
 * ```
 */
export class RateLimiterMiddleware extends MiddlewareService {
  /**
   * Instance-specific bucket storage
   * Key: Client identifier (IP, user ID, etc.)
   * Value: Token bucket state
   */
  private readonly buckets = new Map<string, Bucket>();

  /**
   * Maximum token capacity
   */
  private readonly capacity: number;

  /**
   * Token refill rate (tokens per second)
   */
  private readonly refillRate: number;

  /**
   * Client key generator function
   */
  private readonly keyGenerator: (context: Context) => string;

  /**
   * Rate limit exceeded message
   */
  private readonly message: string;

  /**
   * Rate limit exceeded status code
   */
  private readonly statusCode: number;

  /**
   * Token cost per request
   */
  private readonly cost: number | ((context: Context) => number);

  /**
   * Skip predicate function
   */
  private readonly skip?: (context: Context) => boolean;

  /**
   * Cleanup interval timer ID
   */
  private cleanupTimer?: Timer;

  /**
   * Bucket TTL in milliseconds
   */
  private readonly bucketTTL: number;

  /**
   * Creates a new rate limiter middleware instance
   *
   * @param options - Rate limiter configuration options
   *
   * @example
   * ```typescript
   * @Middleware()
   * export class CustomRateLimiter extends RateLimiterMiddleware {
   *   constructor() {
   *     super({
   *       capacity: 100,
   *       refillRate: 10,
   *       keyGenerator: (ctx) => ctx.getValue('user')?.id || 'anonymous',
   *       message: 'Çok fazla istek gönderdiniz. Lütfen bekleyin.',
   *       skip: (ctx) => ctx.req.url === '/health'
   *     });
   *   }
   * }
   * ```
   */
  public constructor(options: RateLimiterOptions = {}) {
    super();

    // Pre-process and store configuration
    this.capacity = options.capacity ?? 100;
    this.refillRate = options.refillRate ?? 10;
    this.keyGenerator = options.keyGenerator ?? this.defaultKeyGenerator.bind(this);
    this.message = options.message ?? 'Rate limit exceeded. Please try again later.';
    this.statusCode = options.statusCode ?? 429;
    this.cost = options.cost ?? 1;
    this.skip = options.skip;
    this.bucketTTL = options.bucketTTL ?? 600000; // 10 minutes

    // Setup automatic cleanup
    const cleanupInterval = options.cleanupInterval ?? 60000; // 1 minute

    if (cleanupInterval > 0) {
      this.setupCleanup(cleanupInterval);
    }
  }

  /**
   * Rate limiter middleware handler
   *
   * Execution flow:
   * 1. Check if request should be skipped
   * 2. Generate client key (IP, user ID, etc.)
   * 3. Get or create bucket for client
   * 4. Refill tokens based on elapsed time
   * 5. Check if sufficient tokens available
   * 6. Consume tokens and continue, or return 429
   *
   * @param context - Hono context wrapper
   * @param next - Function to call next middleware or handler
   * @returns Response for rate limited requests, or result of next() for allowed requests
   */
  public async handle(context: Context, next: () => Promise<void>): Promise<any> {
    // Check skip predicate
    if (this.skip?.(context)) {
      return await next();
    }

    // Generate client key
    const key = this.keyGenerator(context);

    // Get or create bucket
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = {
        tokens: this.capacity,
        lastRefill: Date.now(),
      };
      this.buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time
    const now = Date.now();
    const elapsedSeconds = (now - bucket.lastRefill) / 1000;
    const tokensToAdd = elapsedSeconds * this.refillRate;

    // Update bucket state
    bucket.tokens = Math.min(bucket.tokens + tokensToAdd, this.capacity);
    bucket.lastRefill = now;

    // Calculate cost for this request
    const requestCost = typeof this.cost === 'function' ? this.cost(context) : this.cost;

    // Check if sufficient tokens available
    if (bucket.tokens < requestCost) {
      // Rate limit exceeded
      const retryAfter = Math.ceil((requestCost - bucket.tokens) / this.refillRate);

      return new Response(this.message, {
        status: this.statusCode,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(Math.floor(this.refillRate * 60)), // Requests per minute
          'X-RateLimit-Remaining': String(Math.floor(bucket.tokens)),
          'X-RateLimit-Reset': String(Math.floor(bucket.lastRefill / 1000 + retryAfter)),
        },
      });
    }

    // Consume tokens
    bucket.tokens -= requestCost;

    // Set rate limit headers using Hono's context
    const honoContext = (context as any).context;

    honoContext.header('X-RateLimit-Limit', String(Math.floor(this.refillRate * 60)));
    honoContext.header('X-RateLimit-Remaining', String(Math.floor(bucket.tokens)));
    honoContext.header('X-RateLimit-Reset', String(Math.floor(bucket.lastRefill / 1000 + 60)));

    // Continue to next middleware/handler
    return await next();
  }

  /**
   * Cleanup resources (stop cleanup timer)
   *
   * Call this when shutting down the application.
   */
  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }

  /**
   * Get current bucket state for a client (for testing/debugging)
   *
   * @param key - Client identifier
   * @returns Bucket state or undefined
   */
  public getBucketState(key: string): Bucket | undefined {
    return this.buckets.get(key);
  }

  /**
   * Clear all buckets (for testing)
   */
  public clearBuckets(): void {
    this.buckets.clear();
  }

  /**
   * Default key generator - uses X-Forwarded-For or CF-Connecting-IP or falls back to 'unknown'
   *
   * @param context - Hono context
   * @returns Client identifier
   */
  private defaultKeyGenerator(context: Context): string {
    return context.req.header('x-forwarded-for') || context.req.header('cf-connecting-ip') || 'unknown';
  }

  /**
   * Setup automatic cleanup of inactive buckets
   *
   * Prevents memory leaks by removing buckets that haven't been accessed recently.
   *
   * @param interval - Cleanup interval in milliseconds
   */
  private setupCleanup(interval: number): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      const keysToDelete: string[] = [];

      // Find inactive buckets
      for (const [key, bucket] of this.buckets.entries()) {
        if (now - bucket.lastRefill > this.bucketTTL) {
          keysToDelete.push(key);
        }
      }

      // Remove inactive buckets
      for (const key of keysToDelete) {
        this.buckets.delete(key);
      }
    }, interval);

    // Unref timer to allow process to exit
    this.cleanupTimer.unref();
  }
}
