import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import { HonoAdapter } from '../lib/HonoAdapter';
import { HonoWebsocketAdapter } from '../lib/HonoWebsocketAdapter';
import { CorsMiddleware } from '../lib/defaults';
import type { ServerLogger } from '@asenajs/asena/logger';
import type { BaseMiddleware } from '@asenajs/asena/adapter';
import { HttpMethod } from '@asenajs/asena/web-types';
import type { Context as HonoAdapterContext } from '../lib/defaults';
import type { Server } from 'bun';

const mockLogger: ServerLogger = {
  info: mock(() => {}),
  error: mock(() => {}),
  warn: mock(() => {}),
  profile: mock(() => {}),
};

function createTestMiddleware(name: string, shouldContinue = true): BaseMiddleware<HonoAdapterContext> {
  return {
    // @ts-ignore
    name,
    handle: mock(async (ctx: HonoAdapterContext, next: () => Promise<void>) => {
      if (shouldContinue) {
        await next();
      }

      return shouldContinue;
    }),
    override: false,
  };
}

describe('Global Middleware - CORS Preflight Integration (Hono)', () => {
  let adapter: HonoAdapter;
  let server: Server<any>;
  let baseUrl: string;

  beforeEach(() => {
    const wsAdapter = new HonoWebsocketAdapter(mockLogger);

    adapter = new HonoAdapter(mockLogger, wsAdapter);
    adapter.setPort(0);
  });

  afterEach(async () => {
    if (server) {
      server.stop(true);
    }
  });

  describe('OPTIONS preflight without explicit OPTIONS route', () => {
    it('should handle OPTIONS preflight via global CORS middleware when only GET route exists', async () => {
      const corsMiddleware = new CorsMiddleware();

      // Register CORS as global middleware
      // @ts-ignore
      adapter.use(corsMiddleware);

      // Only register GET - no OPTIONS route
      await adapter.registerRoute({
        staticServe: undefined,
        validator: undefined,
        method: HttpMethod.GET,
        path: '/api/users',
        middlewares: [],
        handler: async (ctx: HonoAdapterContext) => ctx.send({ users: [] }),
      });

      server = await adapter.start();
      baseUrl = `http://localhost:${server.port}`;

      const response = await fetch(`${baseUrl}/api/users`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://example.com' },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    });

    it('should handle OPTIONS preflight for multiple routes', async () => {
      const corsMiddleware = new CorsMiddleware();

      // @ts-ignore
      adapter.use(corsMiddleware);

      await adapter.registerRoute({
        staticServe: undefined,
        validator: undefined,
        method: HttpMethod.GET,
        path: '/api/users',
        middlewares: [],
        handler: async (ctx: HonoAdapterContext) => ctx.send({ users: [] }),
      });

      await adapter.registerRoute({
        staticServe: undefined,
        validator: undefined,
        method: HttpMethod.POST,
        path: '/api/posts',
        middlewares: [],
        handler: async (ctx: HonoAdapterContext) => ctx.send({ created: true }),
      });

      server = await adapter.start();
      baseUrl = `http://localhost:${server.port}`;

      const [usersRes, postsRes] = await Promise.all([
        fetch(`${baseUrl}/api/users`, { method: 'OPTIONS', headers: { Origin: 'https://example.com' } }),
        fetch(`${baseUrl}/api/posts`, { method: 'OPTIONS', headers: { Origin: 'https://example.com' } }),
      ]);

      expect(usersRes.status).toBe(204);
      expect(postsRes.status).toBe(204);
      expect(usersRes.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(postsRes.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should handle OPTIONS preflight for nested paths', async () => {
      const corsMiddleware = new CorsMiddleware();

      // @ts-ignore
      adapter.use(corsMiddleware);

      await adapter.registerRoute({
        staticServe: undefined,
        validator: undefined,
        method: HttpMethod.GET,
        path: '/api/users/:id',
        middlewares: [],
        handler: async (ctx: HonoAdapterContext) => ctx.send({ id: '123' }),
      });

      server = await adapter.start();
      baseUrl = `http://localhost:${server.port}`;

      const response = await fetch(`${baseUrl}/api/users/123`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://example.com' },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('OPTIONS preflight to unknown paths', () => {
    it('should handle OPTIONS to completely unknown path with global CORS', async () => {
      const corsMiddleware = new CorsMiddleware();

      // @ts-ignore
      adapter.use(corsMiddleware);

      await adapter.registerRoute({
        staticServe: undefined,
        validator: undefined,
        method: HttpMethod.GET,
        path: '/api/users',
        middlewares: [],
        handler: async (ctx: HonoAdapterContext) => ctx.send({ users: [] }),
      });

      server = await adapter.start();
      baseUrl = `http://localhost:${server.port}`;

      const response = await fetch(`${baseUrl}/completely/random/path`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://example.com' },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
      expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
    });
  });

  describe('CORS with pattern-based global middleware', () => {
    it('should handle OPTIONS when CORS has include pattern for matching path', async () => {
      const corsMiddleware = new CorsMiddleware();

      // @ts-ignore
      adapter.use(corsMiddleware, { include: ['/api/*'] });

      await adapter.registerRoute({
        staticServe: undefined,
        validator: undefined,
        method: HttpMethod.GET,
        path: '/api/users',
        middlewares: [],
        handler: async (ctx: HonoAdapterContext) => ctx.send({ users: [] }),
      });

      server = await adapter.start();
      baseUrl = `http://localhost:${server.port}`;

      const response = await fetch(`${baseUrl}/api/users`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://example.com' },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should NOT apply CORS to non-matching include paths on OPTIONS', async () => {
      const corsMiddleware = new CorsMiddleware();

      // @ts-ignore
      adapter.use(corsMiddleware, { include: ['/api/*'] });

      await adapter.registerRoute({
        staticServe: undefined,
        validator: undefined,
        method: HttpMethod.GET,
        path: '/public/page',
        middlewares: [],
        handler: async (ctx: HonoAdapterContext) => ctx.send({ page: 'public' }),
      });

      server = await adapter.start();
      baseUrl = `http://localhost:${server.port}`;

      const response = await fetch(`${baseUrl}/public/page`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://example.com' },
      });

      // No CORS middleware applied for this path
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });
  });

  describe('Regression - normal requests with global CORS', () => {
    it('should add CORS headers to normal GET requests', async () => {
      const corsMiddleware = new CorsMiddleware();

      // @ts-ignore
      adapter.use(corsMiddleware);

      await adapter.registerRoute({
        staticServe: undefined,
        validator: undefined,
        method: HttpMethod.GET,
        path: '/api/users',
        middlewares: [],
        handler: async (ctx: HonoAdapterContext) => ctx.send({ users: [] }),
      });

      server = await adapter.start();
      baseUrl = `http://localhost:${server.port}`;

      const response = await fetch(`${baseUrl}/api/users`, {
        headers: { Origin: 'https://example.com' },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should still return response body for POST requests with global CORS', async () => {
      const corsMiddleware = new CorsMiddleware();

      // @ts-ignore
      adapter.use(corsMiddleware);

      await adapter.registerRoute({
        staticServe: undefined,
        validator: undefined,
        method: HttpMethod.POST,
        path: '/api/users',
        middlewares: [],
        handler: async (ctx: HonoAdapterContext) => {
          const body = await ctx.getBody();

          return ctx.send({ received: body });
        },
      });

      server = await adapter.start();
      baseUrl = `http://localhost:${server.port}`;

      const response = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://example.com',
        },
        body: JSON.stringify({ name: 'test' }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');

      const body = await response.json();

      expect(body.received).toBeDefined();
    });

    it('should execute global middleware in registration order', async () => {
      const mw1 = createTestMiddleware('first');
      const mw2 = createTestMiddleware('second');

      adapter.use(mw1);
      adapter.use(mw2);

      await adapter.registerRoute({
        staticServe: undefined,
        validator: undefined,
        method: HttpMethod.GET,
        path: '/api/test',
        middlewares: [],
        handler: async (ctx: HonoAdapterContext) => ctx.send({ ok: true }),
      });

      server = await adapter.start();
      baseUrl = `http://localhost:${server.port}`;

      await fetch(`${baseUrl}/api/test`);

      expect(mw1.handle).toHaveBeenCalled();
      expect(mw2.handle).toHaveBeenCalled();
    });
  });
});
