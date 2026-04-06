import { describe, expect, it, afterEach } from 'bun:test';
import type { Server } from 'bun';
import { CorsMiddleware } from '../lib/defaults';
import { HttpMethod } from '@asenajs/asena/web-types';
import { createTestAdapter, startTestServer, registerRoute } from './utils/testHelpers';

/**
 * Helper: creates an adapter with a CorsMiddleware as global middleware and a simple test route.
 */
function setupCorsAdapter(corsOptions?: ConstructorParameters<typeof CorsMiddleware>[0]) {
  const { adapter, logger } = createTestAdapter();
  const cors = new CorsMiddleware(corsOptions);

  // @ts-ignore
  adapter.use(cors);

  return { adapter, logger, cors };
}

describe('CorsMiddleware — Integration', () => {
  let server: Server<any> | undefined;

  afterEach(async () => {
    if (server) {
      server.stop(true);
      server = undefined;
    }
  });

  // ─── No Origin Header ────────────────────────────────────────────

  describe('No Origin Header', () => {
    it('should skip CORS when no Origin header present', async () => {
      const { adapter } = setupCorsAdapter();

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`);
      expect(res.status).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });
  });

  // ─── Wildcard Origin ──────────────────────────────────────────────

  describe('Wildcard Origin (*)', () => {
    it('should allow all origins with wildcard', async () => {
      const { adapter } = setupCorsAdapter({ origin: '*' });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`, {
        headers: { Origin: 'https://any-site.com' },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should use wildcard by default when no options provided', async () => {
      const { adapter } = setupCorsAdapter();

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`, {
        headers: { Origin: 'https://example.com' },
      });

      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  // ─── Single String Origin ────────────────────────────────────────

  describe('Single String Origin', () => {
    it('should allow matching origin', async () => {
      const { adapter } = setupCorsAdapter({ origin: 'https://allowed.com' });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`, {
        headers: { Origin: 'https://allowed.com' },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://allowed.com');
    });

    it('should block non-matching origin with 403', async () => {
      const { adapter } = setupCorsAdapter({ origin: 'https://allowed.com' });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`, {
        headers: { Origin: 'https://evil.com' },
      });

      expect(res.status).toBe(403);
    });
  });

  // ─── Array of Origins ────────────────────────────────────────────

  describe('Array of Origins', () => {
    it('should allow origins in array', async () => {
      const { adapter } = setupCorsAdapter({
        origin: ['https://site-a.com', 'https://site-b.com'],
      });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const resA = await fetch(`${baseUrl}/api/data`, {
        headers: { Origin: 'https://site-a.com' },
      });
      expect(resA.status).toBe(200);
      expect(resA.headers.get('Access-Control-Allow-Origin')).toBe('https://site-a.com');

      const resB = await fetch(`${baseUrl}/api/data`, {
        headers: { Origin: 'https://site-b.com' },
      });
      expect(resB.status).toBe(200);
      expect(resB.headers.get('Access-Control-Allow-Origin')).toBe('https://site-b.com');
    });

    it('should block unlisted origin with 403', async () => {
      const { adapter } = setupCorsAdapter({
        origin: ['https://site-a.com', 'https://site-b.com'],
      });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`, {
        headers: { Origin: 'https://evil.com' },
      });

      expect(res.status).toBe(403);
    });
  });

  // ─── Function Origin ──────────────────────────────────────────────

  describe('Function Origin', () => {
    it('should allow when function returns true', async () => {
      const { adapter } = setupCorsAdapter({
        origin: (o) => o.endsWith('.myapp.com'),
      });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`, {
        headers: { Origin: 'https://dashboard.myapp.com' },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://dashboard.myapp.com');
    });

    it('should block when function returns false', async () => {
      const { adapter } = setupCorsAdapter({
        origin: (o) => o.endsWith('.myapp.com'),
      });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`, {
        headers: { Origin: 'https://evil.com' },
      });

      expect(res.status).toBe(403);
    });
  });

  // ─── Preflight OPTIONS ────────────────────────────────────────────

  describe('Preflight OPTIONS', () => {
    it('should return 204 with all CORS headers', async () => {
      const { adapter } = setupCorsAdapter();

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://example.com' },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
      expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
      expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
    });

    it('should include custom methods and headers', async () => {
      const { adapter } = setupCorsAdapter({
        methods: ['GET', 'POST'],
        allowedHeaders: ['X-Custom-Header', 'Authorization'],
        maxAge: 3600,
      });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://example.com' },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST');
      expect(res.headers.get('Access-Control-Allow-Headers')).toBe('X-Custom-Header, Authorization');
      expect(res.headers.get('Access-Control-Max-Age')).toBe('3600');
    });

    it('should include credentials in preflight when enabled', async () => {
      const { adapter } = setupCorsAdapter({ credentials: true });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://example.com' },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });
  });

  // ─── Credentials ──────────────────────────────────────────────────

  describe('Credentials', () => {
    it('should set credentials header on actual requests', async () => {
      const { adapter } = setupCorsAdapter({ credentials: true });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`, {
        headers: { Origin: 'https://example.com' },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });

    it('should not set credentials header when disabled', async () => {
      const { adapter } = setupCorsAdapter({ credentials: false });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`, {
        headers: { Origin: 'https://example.com' },
      });

      expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    });
  });

  // ─── Exposed Headers ──────────────────────────────────────────────

  describe('Exposed Headers', () => {
    it('should set Expose-Headers', async () => {
      const { adapter } = setupCorsAdapter({
        exposedHeaders: ['X-Request-Id', 'X-Total-Count'],
      });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`, {
        headers: { Origin: 'https://example.com' },
      });

      expect(res.headers.get('Access-Control-Expose-Headers')).toBe('X-Request-Id, X-Total-Count');
    });

    it('should not set Expose-Headers when empty', async () => {
      const { adapter } = setupCorsAdapter({ exposedHeaders: [] });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`, {
        headers: { Origin: 'https://example.com' },
      });

      expect(res.headers.get('Access-Control-Expose-Headers')).toBeNull();
    });
  });

  // ─── CORS on POST with Body ───────────────────────────────────────

  describe('CORS preserves request/response body', () => {
    it('should pass through POST body and response correctly', async () => {
      const { adapter } = setupCorsAdapter();

      await registerRoute(adapter, {
        method: HttpMethod.POST,
        path: '/api/echo',
        handler: async (ctx) => {
          const body = await ctx.getBody();
          return ctx.send(body, 201);
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/echo`, {
        method: 'POST',
        headers: {
          Origin: 'https://example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: 'hello' }),
      });

      expect(res.status).toBe(201);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect((await res.json()).message).toBe('hello');
    });
  });
});