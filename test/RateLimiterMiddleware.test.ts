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
    it('should use separate buckets for different forwarded IPs behind a trusted proxy', async () => {
      const { adapter } = setupRateLimitedAdapter({ capacity: 1, refillRate: 0.01, trustProxy: true });

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

  // ─── Stacked Limiters ────────────────────────────────────────────

  describe('Stacked Limiters', () => {
    it('a global and a route limiter leave one X-RateLimit-* header per key', async () => {
      const { adapter } = createTestAdapter();

      const globalLimiter = new RateLimiterMiddleware({ capacity: 100, refillRate: 10, cleanupInterval: 0 });
      const routeLimiter = new RateLimiterMiddleware({ capacity: 50, refillRate: 5, cleanupInterval: 0 });
      rateLimiter = globalLimiter;

      // @ts-ignore
      adapter.use(globalLimiter);

      await registerRoute(adapter, {
        path: '/api/data',
        middlewares: [routeLimiter as any],
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`);
      expect(res.status).toBe(200);

      // The route limiter runs last, so its values win; the old append semantics produced
      // joined duplicates like "600, 300" when both limiters touched the same request.
      expect(res.headers.get('X-RateLimit-Limit')).toBe('300');
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('49');
      expect(res.headers.get('X-RateLimit-Reset')).not.toContain(',');

      routeLimiter.destroy();
    });
  });

  // ─── Client Identity ─────────────────────────────────────────────

  // Any client could set X-Forwarded-For or CF-Connecting-IP and get a fresh bucket per request,
  // which made the limiter a no-op against exactly the traffic it exists to stop. The peer
  // address is the one identifier the client cannot choose.
  describe('Client identity', () => {
    const statuses = async (baseUrl: string, headerSets: Record<string, string>[]): Promise<number[]> => {
      const collected: number[] = [];

      for (const headers of headerSets) {
        const response = await fetch(`${baseUrl}/api/data`, { headers });

        collected.push(response.status);
      }

      return collected;
    };

    const startWith = async (options: ConstructorParameters<typeof RateLimiterMiddleware>[0]) => {
      const { adapter, rateLimiter: rl } = setupRateLimitedAdapter(options);

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      await registerRoute(adapter, {
        path: '/peer',
        handler: (ctx) => ctx.send({ peer: ctx.getRequestIp() }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);

      server = s;

      return { baseUrl, rl: rl! };
    };

    it('should treat a varying X-Forwarded-For as one client', async () => {
      const { baseUrl, rl } = await startWith({ capacity: 2, refillRate: 0.01 });

      const results = await statuses(baseUrl, [
        { 'X-Forwarded-For': '1.1.1.1' },
        { 'X-Forwarded-For': '2.2.2.2' },
        { 'X-Forwarded-For': '3.3.3.3' },
      ]);

      expect(results).toEqual([200, 200, 429]);
      expect(rl.getBucketState('1.1.1.1')).toBeUndefined();
    });

    it('should ignore CF-Connecting-IP', async () => {
      const { baseUrl, rl } = await startWith({ capacity: 2, refillRate: 0.01 });

      const results = await statuses(baseUrl, [
        { 'CF-Connecting-IP': '8.8.8.8' },
        { 'CF-Connecting-IP': '8.8.4.4' },
        { 'CF-Connecting-IP': '1.0.0.1' },
      ]);

      expect(results).toEqual([200, 200, 429]);
      expect(rl.getBucketState('8.8.8.8')).toBeUndefined();
    });

    it('should key on the forwarded hop when the peer is a trusted proxy', async () => {
      const { baseUrl, rl } = await startWith({ capacity: 1, refillRate: 0.01, trustProxy: true });

      const results = await statuses(baseUrl, [
        { 'X-Forwarded-For': '1.1.1.1' },
        { 'X-Forwarded-For': '1.1.1.1' },
        { 'X-Forwarded-For': '2.2.2.2' },
      ]);

      expect(results).toEqual([200, 429, 200]);
      expect(rl.getBucketState('1.1.1.1')).toBeDefined();
    });

    it('should take the rightmost hop and ignore one the client forged on the left', async () => {
      const { baseUrl, rl } = await startWith({ capacity: 2, refillRate: 0.01, trustProxy: true });

      const forged = ['4.4.4.4', '5.5.5.5', '6.6.6.6'];
      const results = await statuses(
        baseUrl,
        forged.map((hop) => ({ 'X-Forwarded-For': `${hop}, 9.9.9.9` })),
      );

      expect(results).toEqual([200, 200, 429]);
      expect(rl.getBucketState('9.9.9.9')).toBeDefined();

      for (const hop of forged) {
        expect(rl.getBucketState(hop)).toBeUndefined();
      }
    });

    it('should ignore the header when the peer is not a listed proxy', async () => {
      const { baseUrl, rl } = await startWith({ capacity: 2, refillRate: 0.01, trustProxy: ['10.0.0.1'] });

      const results = await statuses(baseUrl, [
        { 'X-Forwarded-For': '1.1.1.1' },
        { 'X-Forwarded-For': '2.2.2.2' },
        { 'X-Forwarded-For': '3.3.3.3' },
      ]);

      expect(results).toEqual([200, 200, 429]);
      expect(rl.getBucketState('1.1.1.1')).toBeUndefined();
    });

    it('should walk past every trusted proxy and stop at the client hop', async () => {
      // The peer form varies by listener (`::1`, `::ffff:127.0.0.1`), so it is read back from the
      // server rather than hardcoded.
      let peer: string | null = null;

      const { baseUrl, rl } = await startWith({
        capacity: 2,
        refillRate: 0.01,
        trustProxy: (address) => address === '10.0.0.1' || address === peer,
      });

      peer = ((await (await fetch(`${baseUrl}/peer`)).json()) as { peer: string | null }).peer;

      expect(peer).not.toBeNull();

      const results = await statuses(
        baseUrl,
        ['4.4.4.4', '5.5.5.6', '6.6.6.6'].map((forged) => ({
          'X-Forwarded-For': `${forged}, 5.5.5.5, 10.0.0.1`,
        })),
      );

      expect(results).toEqual([200, 200, 429]);
      expect(rl.getBucketState('5.5.5.5')).toBeDefined();
      expect(rl.getBucketState('10.0.0.1')).toBeUndefined();
    });

    it('should fall back to the peer when the forwarded header is over-long', async () => {
      const { baseUrl, rl } = await startWith({ capacity: 2, refillRate: 0.01, trustProxy: true });

      const longHeader = (seed: number) => `${seed}.0.0.1, ` + '9.9.9.9, '.repeat(130) + '8.8.8.8';

      expect(longHeader(1).length).toBeGreaterThan(1024);

      const results = await statuses(
        baseUrl,
        [1, 2, 3].map((seed) => ({ 'X-Forwarded-For': longHeader(seed) })),
      );

      expect(results).toEqual([200, 200, 429]);
      expect(rl.getBucketState('8.8.8.8')).toBeUndefined();
    });

    it('should see the peer from a route-level limiter with no global middlewares', async () => {
      const { adapter } = createTestAdapter();
      const rl = new RateLimiterMiddleware({ capacity: 2, refillRate: 0.01, cleanupInterval: 0 });

      rateLimiter = rl;

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
        // @ts-ignore
        middlewares: [rl],
      });

      const { server: s, baseUrl } = await startTestServer(adapter);

      server = s;

      const results = await statuses(baseUrl, [
        { 'X-Forwarded-For': '1.1.1.1' },
        { 'X-Forwarded-For': '2.2.2.2' },
        { 'X-Forwarded-For': '3.3.3.3' },
      ]);

      expect(results).toEqual([200, 200, 429]);
      // 'unknown' would mean the context never got the server and every client shares one bucket
      expect(rl.getBucketState('unknown')).toBeUndefined();
    });

    it('should evict the least recently seen client at maxBuckets and let it start over', async () => {
      const { baseUrl, rl } = await startWith({
        capacity: 1,
        refillRate: 0.01,
        maxBuckets: 2,
        keyGenerator: (ctx) => ctx.req.header('x-client') || 'unknown',
      });

      const results = await statuses(baseUrl, [
        { 'x-client': 'c1' },
        { 'x-client': 'c1' },
        { 'x-client': 'c2' },
        { 'x-client': 'c3' },
      ]);

      // The cap trades strict enforcement for bounded memory: c1 was evicted, so its next request
      // starts with a full bucket instead of the 429 it had earned.
      expect(results).toEqual([200, 429, 200, 200]);
      expect(rl.getBucketState('c1')).toBeUndefined();
      expect(rl.getBucketState('c2')).toBeDefined();
      expect(rl.getBucketState('c3')).toBeDefined();

      const [readmitted] = await statuses(baseUrl, [{ 'x-client': 'c1' }]);

      expect(readmitted).toBe(200);
      expect(rl.getBucketState('c2')).toBeUndefined();
    });

    it('should evict the idle client rather than the recently seen one', async () => {
      const { baseUrl, rl } = await startWith({
        capacity: 5,
        refillRate: 0.01,
        maxBuckets: 2,
        keyGenerator: (ctx) => ctx.req.header('x-client') || 'unknown',
      });

      // c1 is touched again after c2, so insertion order alone (c1, c2) is not the eviction order
      await statuses(baseUrl, [{ 'x-client': 'c1' }, { 'x-client': 'c2' }, { 'x-client': 'c1' }, { 'x-client': 'c3' }]);

      expect(rl.getBucketState('c2')).toBeUndefined();
      expect(rl.getBucketState('c1')).toBeDefined();
      expect(rl.getBucketState('c3')).toBeDefined();
    });
  });

  // ─── Bucket Management ────────────────────────────────────────────

  describe('Bucket Management', () => {
    it('getBucketState() should return bucket info after request', async () => {
      // Trusted so the bucket key is the forwarded address this test can name
      const { adapter, rateLimiter: rl } = setupRateLimitedAdapter({
        capacity: 10,
        refillRate: 1,
        trustProxy: true,
      });

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
      // Trusted so the bucket key is the forwarded address this test can name
      const { adapter, rateLimiter: rl } = setupRateLimitedAdapter({
        capacity: 1,
        refillRate: 0.01,
        trustProxy: true,
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
        // Trusted so the bucket key is the forwarded address this test can name
        trustProxy: true,
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
    it('should key on the connecting peer when no proxy is trusted', async () => {
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

describe('RateLimiterMiddleware — maxBuckets validation', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('should reject maxBuckets = %p', (maxBuckets) => {
    expect(() => new RateLimiterMiddleware({ maxBuckets, cleanupInterval: 0 })).toThrow(
      /maxBuckets must be a positive integer/,
    );
  });

  it('should accept maxBuckets = 1 and hold at most one bucket', async () => {
    const rl = new RateLimiterMiddleware({
      maxBuckets: 1,
      cleanupInterval: 0,
      keyGenerator: (ctx) => ctx.req.header('x-client') || 'unknown',
    });
    const context = (client: string) => ({ req: { header: () => client }, setResponseHeader: () => {} }) as any;

    await rl.handle(context('c1'), async () => {});
    await rl.handle(context('c2'), async () => {});

    expect(rl.getBucketState('c1')).toBeUndefined();
    expect(rl.getBucketState('c2')).toBeDefined();

    rl.destroy();
  });
});
