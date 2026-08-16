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

    it('should serve a non-matching origin without CORS headers, not 403', async () => {
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

      // CORS is browser-enforced: the denial is a missing header, not a server-side 403, which
      // would also turn away non-browser callers that merely happen to send an Origin.
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
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

    it('should serve an unlisted origin without CORS headers, not 403', async () => {
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

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
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

    it('should serve without CORS headers when function returns false, not 403', async () => {
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

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
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

  // ─── Vary: Origin ─────────────────────────────────────────────────

  /**
   * Why these matter: with any non-'*' config the allowed-origin header is computed from the
   * request's own Origin. A shared cache that does not know this will hand one origin's response -
   * complete with its Access-Control-Allow-Origin - to a request from a different origin. `Vary`
   * is the only thing that tells it to key on the header. For a public API behind a CDN this is
   * the difference between a policy and a cache-poisoning primitive.
   */
  describe('Vary: Origin', () => {
    it('should set Vary: Origin for an array config', async () => {
      const { adapter } = setupCorsAdapter({ origin: ['https://site-a.com'] });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`, {
        headers: { Origin: 'https://site-a.com' },
      });

      expect(res.headers.get('Vary')).toContain('Origin');
    });

    it('should set Vary: Origin for a function config', async () => {
      const { adapter } = setupCorsAdapter({ origin: (o) => o.endsWith('.myapp.com') });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`, {
        headers: { Origin: 'https://dashboard.myapp.com' },
      });

      expect(res.headers.get('Vary')).toContain('Origin');
    });

    it('should set Vary: Origin even when the origin is refused', async () => {
      const { adapter } = setupCorsAdapter({ origin: ['https://site-a.com'] });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`, {
        headers: { Origin: 'https://evil.com' },
      });

      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(res.headers.get('Vary')).toContain('Origin');
    });

    it('should not set Vary for the wildcard config', async () => {
      const { adapter } = setupCorsAdapter({ origin: '*' });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`, {
        headers: { Origin: 'https://anywhere.com' },
      });

      // '*' answers every origin the same, so a per-origin cache key would only cost hit rate.
      expect(res.headers.get('Vary')).toBeNull();
    });

    it('should set Vary: Origin on the preflight 204 too', async () => {
      const { adapter } = setupCorsAdapter({ origin: ['https://site-a.com'] });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://site-a.com' },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('Vary')).toContain('Origin');
    });
  });

  // ─── Preflight preserves upstream headers ─────────────────────────

  describe('Preflight header preservation', () => {
    it('should keep headers set by an earlier middleware on the 204', async () => {
      const { adapter } = createTestAdapter();

      // Registered *before* CORS so it has run by the time the preflight short-circuits; the old
      // fresh-headers object dropped it from the 204 alone, while every other method kept it.
      // @ts-ignore - test middleware shape
      adapter.use({
        handle: async (ctx: any, next: () => Promise<void>) => {
          ctx.setResponseHeader('X-Request-Id', 'req-42');
          return await next();
        },
      });

      // @ts-ignore
      adapter.use(new CorsMiddleware());

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
      expect(res.headers.get('X-Request-Id')).toBe('req-42');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should answer a refused preflight 204 without CORS headers', async () => {
      const { adapter } = setupCorsAdapter({ origin: ['https://site-a.com'] });

      await registerRoute(adapter, {
        path: '/api/data',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api/data`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.com' },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(res.headers.get('Access-Control-Allow-Methods')).toBeNull();
      // A cache not keyed on Origin would replay this empty 204 to an allowed origin.
      expect(res.headers.get('Vary')).toContain('Origin');
    });
  });
});
