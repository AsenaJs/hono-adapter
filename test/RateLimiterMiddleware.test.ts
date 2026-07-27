import { describe, expect, it, afterEach } from 'bun:test';
import type { Server } from 'bun';
import { RateLimiterMiddleware } from '../lib/middlewares/RateLimiterMiddleware';
import { HttpMethod } from '@asenajs/asena/web-types';
import { createTestAdapter, startTestServer, registerRoute, sleep } from './utils/testHelpers';

describe('RateLimiterMiddleware — Integration', () => {
  let server: Server<any> | undefined;
  let rateLimiter: RateLimiterMiddleware | undefined;

  afterEach(async () => {
    if (server) {
      server.stop(true);
      server = undefined;
    }
    if (rateLimiter) {
      rateLimiter.destroy();
      rateLimiter = undefined;
    }
  });

  function setupRateLimitedAdapter(options?: ConstructorParameters<typeof RateLimiterMiddleware>[0]) {
    const { adapter, logger } = createTestAdapter();

    rateLimiter = new RateLimiterMiddleware({
      cleanupInterval: 0, // disable cleanup by default to avoid timer leaks
      ...options,
    });

    // @ts-ignore
    adapter.use(rateLimiter);

    return { adapter, logger, rateLimiter };
  }

  // ─── Basic Rate Limiting ──────────────────────────────────────────

  describe('Basic Rate Limiting', () => {
    it('should allow requests when bucket has tokens', async () => {
      const { adapter } = setupRateLimitedAdapter({ capacity: 10, refillRate: 1 });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`);
      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Limit')).toBeDefined();
      expect(res.headers.get('X-RateLimit-Remaining')).toBeDefined();
      expect(res.headers.get('X-RateLimit-Reset')).toBeDefined();
    });

    it('should block requests when bucket is empty with 429', async () => {
      const { adapter } = setupRateLimitedAdapter({ capacity: 2, refillRate: 0.01 });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      // Exhaust bucket
      await fetch(`${baseUrl}/api/data`);
      await fetch(`${baseUrl}/api/data`);

      // This should be rate limited
      const res = await fetch(`${baseUrl}/api/data`);
      expect(res.status).toBe(429);

      const body = await res.text();
      expect(body).toContain('Rate limit exceeded');
      expect(res.headers.get('Retry-After')).toBeDefined();
    });

    it('should include rate limit headers on allowed requests', async () => {
      const { adapter } = setupRateLimitedAdapter({ capacity: 100, refillRate: 10 });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`);
      expect(res.status).toBe(200);

      // refillRate=10 → 600 requests/minute
      expect(res.headers.get('X-RateLimit-Limit')).toBe('600');
      // Should be capacity - 1
      expect(Number(res.headers.get('X-RateLimit-Remaining'))).toBe(99);
    });
  });

  // ─── Token Bucket Algorithm ───────────────────────────────────────

  describe('Token Bucket Algorithm', () => {
    it('should refill tokens over time', async () => {
      const { adapter } = setupRateLimitedAdapter({ capacity: 2, refillRate: 100 });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      // Exhaust bucket
      await fetch(`${baseUrl}/api/data`);
      await fetch(`${baseUrl}/api/data`);

      // Should be rate limited now
      const blocked = await fetch(`${baseUrl}/api/data`);
      expect(blocked.status).toBe(429);

      // Wait for refill (refillRate=100 tokens/sec, need 1 token → 10ms should be enough)
      await sleep(50);

      // Should be allowed now
      const allowed = await fetch(`${baseUrl}/api/data`);
      expect(allowed.status).toBe(200);
    });

    it('should not exceed maximum capacity', async () => {
      const { adapter, rateLimiter: rl } = setupRateLimitedAdapter({ capacity: 5, refillRate: 1000 });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      // Wait to let tokens accumulate
      await sleep(50);

      // First request — remaining should be capacity - 1 = 4
      const res = await fetch(`${baseUrl}/api/data`);
      expect(res.status).toBe(200);

      const remaining = Number(res.headers.get('X-RateLimit-Remaining'));
      expect(remaining).toBeLessThanOrEqual(4);
    });
  });

  // ─── Per-Client Isolation ─────────────────────────────────────────

  describe('Per-Client Isolation', () => {
    it('should use separate buckets for different IPs', async () => {
      const { adapter } = setupRateLimitedAdapter({ capacity: 1, refillRate: 0.01 });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      // Client A exhausts its bucket
      const resA1 = await fetch(`${baseUrl}/api/data`, {
        headers: { 'X-Forwarded-For': '1.1.1.1' },
      });
      expect(resA1.status).toBe(200);

      const resA2 = await fetch(`${baseUrl}/api/data`, {
        headers: { 'X-Forwarded-For': '1.1.1.1' },
      });
      expect(resA2.status).toBe(429);

      // Client B should still have tokens
      const resB = await fetch(`${baseUrl}/api/data`, {
        headers: { 'X-Forwarded-For': '2.2.2.2' },
      });
      expect(resB.status).toBe(200);
    });
  });

  // ─── Custom Key Generator ────────────────────────────────────────

  describe('Custom Key Generator', () => {
    it('should group by custom header', async () => {
      const { adapter } = setupRateLimitedAdapter({
        capacity: 1,
        refillRate: 0.01,
        keyGenerator: (ctx) => {
          const req = ctx.req as any;
          return typeof req.header === 'function' ? req.header('x-api-key') || 'anon' : 'anon';
        },
      });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      // User A exhausts its bucket
      await fetch(`${baseUrl}/api/data`, { headers: { 'X-Api-Key': 'user-a' } });
      const blockedA = await fetch(`${baseUrl}/api/data`, { headers: { 'X-Api-Key': 'user-a' } });
      expect(blockedA.status).toBe(429);

      // User B should still have tokens
      const allowedB = await fetch(`${baseUrl}/api/data`, { headers: { 'X-Api-Key': 'user-b' } });
      expect(allowedB.status).toBe(200);
    });
  });

  // ─── Skip Predicate ───────────────────────────────────────────────

  describe('Skip Predicate', () => {
    it('should skip rate limiting for matching paths', async () => {
      const { adapter } = setupRateLimitedAdapter({
        capacity: 1,
        refillRate: 0.01,
        skip: (ctx) => {
          const req = ctx.req as any;
          const url = typeof req.url === 'string' ? req.url : '';
          return url.includes('/health');
        },
      });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      await registerRoute(adapter, {
        path: '/health',
        handler: (ctx) => ctx.send({ status: 'ok' }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      // Exhaust bucket on /api/data
      await fetch(`${baseUrl}/api/data`);
      const blocked = await fetch(`${baseUrl}/api/data`);
      expect(blocked.status).toBe(429);

      // /health should still work (skipped)
      const health = await fetch(`${baseUrl}/health`);
      expect(health.status).toBe(200);
    });
  });

  // ─── Custom Cost ──────────────────────────────────────────────────

  describe('Custom Cost', () => {
    it('should consume fixed cost per request', async () => {
      const { adapter } = setupRateLimitedAdapter({
        capacity: 10,
        refillRate: 0.01,
        cost: 5,
      });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      // First request: 10 - 5 = 5 tokens remaining
      const res1 = await fetch(`${baseUrl}/api/data`);
      expect(res1.status).toBe(200);

      // Second request: 5 - 5 = 0 tokens remaining
      const res2 = await fetch(`${baseUrl}/api/data`);
      expect(res2.status).toBe(200);

      // Third request: 0 tokens — rate limited
      const res3 = await fetch(`${baseUrl}/api/data`);
      expect(res3.status).toBe(429);
    });

    it('should support function-based cost', async () => {
      const { adapter } = setupRateLimitedAdapter({
        capacity: 10,
        refillRate: 0.01,
        cost: (ctx) => {
          const req = ctx.req as any;
          const url = typeof req.url === 'string' ? req.url : '';
          return url.includes('/expensive') ? 10 : 1;
        },
      });

      await registerRoute(adapter, {
        path: '/cheap',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      await registerRoute(adapter, {
        path: '/expensive',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      // Expensive request consumes all 10 tokens
      const expRes = await fetch(`${baseUrl}/expensive`);
      expect(expRes.status).toBe(200);

      // Cheap request should now be blocked (0 tokens)
      const cheapRes = await fetch(`${baseUrl}/cheap`);
      expect(cheapRes.status).toBe(429);
    });
  });

  // ─── Custom Message and Status Code ───────────────────────────────

  describe('Custom Message and Status Code', () => {
    it('should use custom message and status code', async () => {
      const { adapter } = setupRateLimitedAdapter({
        capacity: 1,
        refillRate: 0.01,
        message: 'Too many requests, slow down!',
        statusCode: 503,
      });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      await fetch(`${baseUrl}/api/data`);
      const res = await fetch(`${baseUrl}/api/data`);
      expect(res.status).toBe(503);

      const body = await res.text();
      expect(body).toBe('Too many requests, slow down!');
    });
  });

  // ─── Bucket Management ────────────────────────────────────────────

  describe('Bucket Management', () => {
    it('getBucketState() should return bucket info after request', async () => {
      const { adapter, rateLimiter: rl } = setupRateLimitedAdapter({ capacity: 10, refillRate: 1 });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      await fetch(`${baseUrl}/api/data`, {
        headers: { 'X-Forwarded-For': '10.0.0.1' },
      });

      const bucket = rl!.getBucketState('10.0.0.1');
      expect(bucket).toBeDefined();
      expect(bucket!.tokens).toBeLessThan(10);
    });

    it('clearBuckets() should reset state', async () => {
      const { adapter, rateLimiter: rl } = setupRateLimitedAdapter({
        capacity: 1,
        refillRate: 0.01,
      });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      await fetch(`${baseUrl}/api/data`, { headers: { 'X-Forwarded-For': '10.0.0.1' } });
      expect(rl!.getBucketState('10.0.0.1')).toBeDefined();

      rl!.clearBuckets();
      expect(rl!.getBucketState('10.0.0.1')).toBeUndefined();

      // After clear, should be allowed again
      const res = await fetch(`${baseUrl}/api/data`, { headers: { 'X-Forwarded-For': '10.0.0.1' } });
      expect(res.status).toBe(200);
    });

    it('destroy() should clean up timer', () => {
      const rl = new RateLimiterMiddleware({ cleanupInterval: 1000 });
      // Should not throw
      rl.destroy();
      rl.destroy(); // Double destroy should be safe
    });
  });

  // ─── Cleanup ──────────────────────────────────────────────────────

  describe('Cleanup', () => {
    it('should remove inactive buckets after TTL', async () => {
      const rl = new RateLimiterMiddleware({
        capacity: 10,
        refillRate: 1,
        cleanupInterval: 50,
        bucketTTL: 50,
      });
      rateLimiter = rl;

      const { adapter } = createTestAdapter();

      // @ts-ignore
      adapter.use(rl);

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      // Make request to create bucket
      await fetch(`${baseUrl}/api/data`, { headers: { 'X-Forwarded-For': '10.0.0.1' } });
      expect(rl.getBucketState('10.0.0.1')).toBeDefined();

      // Wait for cleanup to run
      await sleep(200);

      // Bucket should be cleaned up
      expect(rl.getBucketState('10.0.0.1')).toBeUndefined();
    });
  });

  // ─── Edge Cases ───────────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('should handle unknown IP gracefully', async () => {
      const { adapter } = setupRateLimitedAdapter({ capacity: 10, refillRate: 1 });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      // No IP headers — should use fallback key
      const res = await fetch(`${baseUrl}/api/data`);
      expect(res.status).toBe(200);
    });

    it('should use CF-Connecting-IP as fallback', async () => {
      const { adapter, rateLimiter: rl } = setupRateLimitedAdapter({
        capacity: 10,
        refillRate: 1,
      });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      await fetch(`${baseUrl}/api/data`, {
        headers: { 'CF-Connecting-IP': '8.8.8.8' },
      });

      expect(rl!.getBucketState('8.8.8.8')).toBeDefined();
    });

    it('should immediately rate limit with zero capacity', async () => {
      const { adapter } = setupRateLimitedAdapter({ capacity: 0, refillRate: 0 });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`);
      expect(res.status).toBe(429);
    });
  });
});
