import { describe, expect, it, mock } from 'bun:test';
import { RateLimiterMiddleware } from '../lib/middlewares/RateLimiterMiddleware';
import type { AsenaContext } from '@asenajs/asena/adapter';
import type { HonoRequest } from 'hono';

describe('RateLimiterMiddleware', () => {
  const createMockContext = (ip = '127.0.0.1', url = '/api/test') => {
    const headers = new Map<string, string>();

    const mockContext = {
      req: {
        url,
        header: mock((name: string) => {
          if (name === 'x-forwarded-for') return ip;

          if (name === 'cf-connecting-ip') return undefined;

          return undefined;
        }),
      } as unknown as HonoRequest,
      getValue: mock((key: string) => {
        if (key === 'user') return { id: 'user123', role: 'user' };

        return undefined;
      }),
      context: {
        header: mock((key: string, value: string) => {
          headers.set(key, value);
        }),
      },
      _headers: headers,
    };

    return mockContext as any;
  };

  describe('Constructor and Default Options', () => {
    it('should create middleware with default options', () => {
      const middleware = new RateLimiterMiddleware();

      expect(middleware).toBeDefined();
    });

    it('should create middleware with custom options', () => {
      const middleware = new RateLimiterMiddleware({
        capacity: 50,
        refillRate: 5,
        message: 'Custom rate limit message',
        statusCode: 429,
      });

      expect(middleware).toBeDefined();
    });

    it('should create middleware with custom key generator', () => {
      const middleware = new RateLimiterMiddleware({
        keyGenerator: (ctx) => ctx.getValue<any>('user')?.id || 'anonymous',
      });

      expect(middleware).toBeDefined();
    });
  });

  describe('Basic Rate Limiting', () => {
    it('should allow request when bucket has tokens', async () => {
      const middleware = new RateLimiterMiddleware({ capacity: 10, refillRate: 10 });
      const context = createMockContext('192.168.1.1');
      const next = mock(() => Promise.resolve());

      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(next).toHaveBeenCalled();
    });

    it('should block request when bucket is empty', async () => {
      const middleware = new RateLimiterMiddleware({ capacity: 2, refillRate: 1 });
      const context = createMockContext('192.168.1.2');
      const next = mock(() => Promise.resolve());

      // First request - allowed
      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Second request - allowed
      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);
      expect(next).toHaveBeenCalledTimes(2);

      // Third request - blocked (bucket empty)
      const response = await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(next).toHaveBeenCalledTimes(2); // Not called again
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(429);

      const text = await response.text();

      expect(text).toBe('Rate limit exceeded. Please try again later.');
    });

    it('should set rate limit headers for allowed requests', async () => {
      const middleware = new RateLimiterMiddleware({ capacity: 100, refillRate: 10 });
      const context = createMockContext('192.168.1.3');
      const next = mock(() => Promise.resolve());

      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(context.context.header).toHaveBeenCalledWith('X-RateLimit-Limit', '600'); // 10 * 60
      expect(context.context.header).toHaveBeenCalledWith('X-RateLimit-Remaining', expect.any(String));
      expect(context.context.header).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(String));
    });

    it('should set rate limit headers for blocked requests', async () => {
      const middleware = new RateLimiterMiddleware({ capacity: 1, refillRate: 1 });
      const context = createMockContext('192.168.1.4');
      const next = mock(() => Promise.resolve());

      // Consume the only token
      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      // Block next request
      const response = await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get('Retry-After')).toBeDefined();
      expect(response.headers.get('X-RateLimit-Limit')).toBe('60'); // 1 * 60
      expect(response.headers.get('X-RateLimit-Remaining')).toBeDefined();
      expect(response.headers.get('X-RateLimit-Reset')).toBeDefined();
    });
  });

  describe('Token Bucket Algorithm', () => {
    it('should refill tokens over time', async () => {
      const middleware = new RateLimiterMiddleware({ capacity: 10, refillRate: 100 }); // 100 tokens per second
      const context = createMockContext('192.168.1.5');
      const next = mock(() => Promise.resolve());

      // First request
      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Wait 100ms (should refill ~10 tokens)
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });

      // Second request should be allowed
      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);
      expect(next).toHaveBeenCalledTimes(2);
    });

    it('should not exceed maximum capacity', async () => {
      const middleware = new RateLimiterMiddleware({ capacity: 5, refillRate: 100 });
      const context = createMockContext('192.168.1.6');
      const next = mock(() => Promise.resolve());

      // Wait to ensure refill happens (tokens should cap at capacity = 5)
      await new Promise((resolve) => {
        setTimeout(resolve, 200);
      });

      // Make 5 requests (should all succeed)
      for (let i = 0; i < 5; i++) {
        await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);
      }

      expect(next).toHaveBeenCalledTimes(5);

      // 6th request should fail
      const response = await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(response.status).toBe(429);
      expect(next).toHaveBeenCalledTimes(5);
    });
  });

  describe('Custom Key Generator', () => {
    it('should use custom key generator based on user ID', async () => {
      const middleware = new RateLimiterMiddleware({
        capacity: 2,
        refillRate: 1,
        keyGenerator: (ctx) => ctx.getValue<any>('user')?.id || 'anonymous',
      });

      const context1 = createMockContext('192.168.1.7'); // Same IP
      const context2 = createMockContext('192.168.1.7'); // Same IP, but should use user ID
      const next = mock(() => Promise.resolve());

      // Both contexts have same IP but same user ID (user123), so they share bucket
      await middleware.handle(context1 as AsenaContext<HonoRequest, Response>, next);
      await middleware.handle(context2 as AsenaContext<HonoRequest, Response>, next);

      expect(next).toHaveBeenCalledTimes(2);

      // Third request should be blocked (same user bucket)
      const response = await middleware.handle(context1 as AsenaContext<HonoRequest, Response>, next);

      expect(response.status).toBe(429);
    });
  });

  describe('Skip Predicate', () => {
    it('should skip rate limiting based on predicate', async () => {
      const middleware = new RateLimiterMiddleware({
        capacity: 1,
        refillRate: 1,
        skip: (ctx) => ctx.req.url === '/health',
      });

      const healthContext = createMockContext('192.168.1.8', '/health');
      const apiContext = createMockContext('192.168.1.8', '/api/test');
      const next = mock(() => Promise.resolve());

      // Health check should always pass (no rate limiting)
      await middleware.handle(healthContext as AsenaContext<HonoRequest, Response>, next);
      await middleware.handle(healthContext as AsenaContext<HonoRequest, Response>, next);
      await middleware.handle(healthContext as AsenaContext<HonoRequest, Response>, next);

      expect(next).toHaveBeenCalledTimes(3);

      // API endpoint should be rate limited
      await middleware.handle(apiContext as AsenaContext<HonoRequest, Response>, next);
      expect(next).toHaveBeenCalledTimes(4);

      const response = await middleware.handle(apiContext as AsenaContext<HonoRequest, Response>, next);

      expect(response.status).toBe(429);
      expect(next).toHaveBeenCalledTimes(4);
    });

    it('should skip rate limiting for admin users', async () => {
      const middleware = new RateLimiterMiddleware({
        capacity: 1,
        refillRate: 1,
        skip: (ctx) => ctx.getValue<any>('user')?.role === 'admin',
      });

      const adminContext = {
        ...createMockContext('192.168.1.9'),
        getValue: mock((key: string) => {
          if (key === 'user') return { id: 'admin123', role: 'admin' };

          return undefined;
        }),
      };

      const next = mock(() => Promise.resolve());

      // Admin should never be rate limited
      for (let i = 0; i < 10; i++) {
        await middleware.handle(adminContext as AsenaContext<HonoRequest, Response>, next);
      }

      expect(next).toHaveBeenCalledTimes(10);
    });
  });

  describe('Custom Cost', () => {
    it('should use custom cost per request (fixed)', async () => {
      const middleware = new RateLimiterMiddleware({
        capacity: 10,
        refillRate: 10,
        cost: 5, // Each request costs 5 tokens
      });

      const context = createMockContext('192.168.1.10');
      const next = mock(() => Promise.resolve());

      // First request costs 5 tokens (5 remaining)
      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Second request costs 5 tokens (0 remaining)
      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);
      expect(next).toHaveBeenCalledTimes(2);

      // Third request should be blocked (not enough tokens)
      const response = await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(response.status).toBe(429);
      expect(next).toHaveBeenCalledTimes(2);
    });

    it('should use custom cost per request (function)', async () => {
      const middleware = new RateLimiterMiddleware({
        capacity: 10,
        refillRate: 10,
        cost: (ctx) => (ctx.req.url.includes('/expensive') ? 5 : 1),
      });

      const cheapContext = createMockContext('192.168.1.11', '/api/cheap');
      const expensiveContext = createMockContext('192.168.1.11', '/api/expensive');
      const next = mock(() => Promise.resolve());

      // Cheap request costs 1 token (9 remaining)
      await middleware.handle(cheapContext as AsenaContext<HonoRequest, Response>, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Expensive request costs 5 tokens (4 remaining)
      await middleware.handle(expensiveContext as AsenaContext<HonoRequest, Response>, next);
      expect(next).toHaveBeenCalledTimes(2);

      // Another expensive request should be blocked (not enough tokens)
      const response = await middleware.handle(expensiveContext as AsenaContext<HonoRequest, Response>, next);

      expect(response.status).toBe(429);
      expect(next).toHaveBeenCalledTimes(2);
    });
  });

  describe('Custom Messages and Status Codes', () => {
    it('should use custom message and status code', async () => {
      const middleware = new RateLimiterMiddleware({
        capacity: 1,
        refillRate: 1,
        message: 'Çok fazla istek gönderdiniz. Lütfen bekleyin.',
        statusCode: 429,
      });

      const context = createMockContext('192.168.1.12');
      const next = mock(() => Promise.resolve());

      // Consume token
      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      // Block next request
      const response = await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(response.status).toBe(429);

      const text = await response.text();

      expect(text).toBe('Çok fazla istek gönderdiniz. Lütfen bekleyin.');
    });
  });

  describe('Per-Client Isolation', () => {
    it('should maintain separate buckets for different clients', async () => {
      const middleware = new RateLimiterMiddleware({ capacity: 1, refillRate: 1 });

      const context1 = createMockContext('192.168.1.13');
      const context2 = createMockContext('192.168.1.14');
      const next = mock(() => Promise.resolve());

      // Client 1 - first request (allowed)
      await middleware.handle(context1 as AsenaContext<HonoRequest, Response>, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Client 1 - second request (blocked)
      const response1 = await middleware.handle(context1 as AsenaContext<HonoRequest, Response>, next);

      expect(response1.status).toBe(429);
      expect(next).toHaveBeenCalledTimes(1);

      // Client 2 - first request (allowed, different bucket)
      await middleware.handle(context2 as AsenaContext<HonoRequest, Response>, next);
      expect(next).toHaveBeenCalledTimes(2);
    });
  });

  describe('Bucket Management', () => {
    it('should get bucket state for debugging', async () => {
      const middleware = new RateLimiterMiddleware({ capacity: 10, refillRate: 10 });
      const context = createMockContext('192.168.1.15');
      const next = mock(() => Promise.resolve());

      // Make a request to create bucket
      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      const bucketState = middleware.getBucketState('192.168.1.15');

      expect(bucketState).toBeDefined();
      expect(bucketState?.tokens).toBeLessThan(10); // One token consumed
      expect(bucketState?.lastRefill).toBeDefined();
    });

    it('should clear all buckets', async () => {
      const middleware = new RateLimiterMiddleware({ capacity: 10, refillRate: 10 });
      const context = createMockContext('192.168.1.16');
      const next = mock(() => Promise.resolve());

      // Create a bucket
      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      // Clear buckets
      middleware.clearBuckets();

      // Bucket should no longer exist
      const bucketState = middleware.getBucketState('192.168.1.16');

      expect(bucketState).toBeUndefined();
    });

    it('should destroy cleanup timer', () => {
      const middleware = new RateLimiterMiddleware({
        capacity: 10,
        refillRate: 10,
        cleanupInterval: 1000,
      });

      // Should not throw
      expect(() => middleware.destroy()).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle unknown IP gracefully', async () => {
      const middleware = new RateLimiterMiddleware({ capacity: 10, refillRate: 10 });
      const context = {
        ...createMockContext('192.168.1.17'),
        req: {
          url: '/test',
          header: mock(() => undefined), // No IP headers
        },
      };
      const next = mock(() => Promise.resolve());

      // Should use 'unknown' as key
      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(next).toHaveBeenCalled();

      const bucketState = middleware.getBucketState('unknown');

      expect(bucketState).toBeDefined();
    });

    it('should handle CF-Connecting-IP header', async () => {
      const middleware = new RateLimiterMiddleware({ capacity: 10, refillRate: 10 });
      const context = {
        ...createMockContext('192.168.1.18'),
        req: {
          url: '/test',
          header: mock((name: string) => {
            if (name === 'x-forwarded-for') return undefined;

            if (name === 'cf-connecting-ip') return '203.0.113.1';

            return undefined;
          }),
        },
      };
      const next = mock(() => Promise.resolve());

      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(next).toHaveBeenCalled();

      const bucketState = middleware.getBucketState('203.0.113.1');

      expect(bucketState).toBeDefined();
    });

    it('should handle zero capacity gracefully', async () => {
      const middleware = new RateLimiterMiddleware({ capacity: 0, refillRate: 10 });
      const context = createMockContext('192.168.1.19');
      const next = mock(() => Promise.resolve());

      // Should immediately rate limit (no capacity)
      const response = await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(response.status).toBe(429);
      expect(next).not.toHaveBeenCalled();
    });

    it('should disable cleanup when cleanupInterval is 0', () => {
      const middleware = new RateLimiterMiddleware({
        capacity: 10,
        refillRate: 10,
        cleanupInterval: 0,
      });

      // Should not throw
      expect(() => middleware.destroy()).not.toThrow();
    });
  });
});
