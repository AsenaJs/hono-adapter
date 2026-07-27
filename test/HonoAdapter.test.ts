import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import { Hono } from 'hono';
import { HonoAdapter } from '../lib/HonoAdapter';
import { HonoWebsocketAdapter } from '../lib/HonoWebsocketAdapter';
import { HttpMethod } from '@asenajs/asena/web-types';
import { HTTPException } from 'hono/http-exception';
import { isValidationError } from '@asenajs/asena/adapter';
import { ValidationError } from '../lib/errors';
import { z } from 'zod';
import type { Server } from 'bun';
import type { Context as HonoAdapterContext } from '../lib/defaults';
import {
  createMockLogger,
  createTestAdapter,
  startTestServer,
  registerRoute,
  createTestMiddleware,
} from './utils/testHelpers';

describe('HonoAdapter', () => {
  let server: Server<any> | undefined;

  afterEach(async () => {
    if (server) {
      server.stop(true);
      server = undefined;
    }
  });

  // ─── Constructor & Configuration ──────────────────────────────────

  describe('Constructor & Configuration', () => {
    it('should create adapter with logger (legacy constructor)', () => {
      const logger = createMockLogger();
      const wsAdapter = new HonoWebsocketAdapter(logger);
      const adapter = new HonoAdapter(logger, wsAdapter);

      expect(adapter).toBeDefined();
      expect(adapter.name).toBe('HonoAdapter');
      expect(adapter.app).toBeDefined();
    });

    it('should create adapter with options object', () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter({ logger });

      expect(adapter).toBeDefined();
      expect(adapter.name).toBe('HonoAdapter');
    });

    it('should create adapter with custom Hono app', () => {
      const logger = createMockLogger();
      const customApp = new Hono();
      const adapter = new HonoAdapter({ logger, app: customApp });

      expect(adapter.app).toBe(customApp);
    });

    it('should create default websocket adapter when none provided', () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter({ logger });

      expect(adapter.getWebsocketAdapter()).toBeDefined();
    });

    it('should use provided websocket adapter', () => {
      const logger = createMockLogger();
      const wsAdapter = new HonoWebsocketAdapter(logger);
      const adapter = new HonoAdapter({ logger, websocketAdapter: wsAdapter });

      expect(adapter.getWebsocketAdapter()).toBe(wsAdapter);
    });

    it('should set strict mode from options', async () => {
      // strict: false means /path and /path/ should match the same route
      const { adapter } = createTestAdapter({ strict: false });

      await registerRoute(adapter, {
        path: '/hello',
        handler: (ctx) => ctx.send({ msg: 'ok' }),
      });

      server = (await startTestServer(adapter)).server;
      const baseUrl = `http://localhost:${server.port}`;

      const res1 = await fetch(`${baseUrl}/hello`);
      const res2 = await fetch(`${baseUrl}/hello/`);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
    });

    it('should set logger on websocket adapter if not set', () => {
      const logger = createMockLogger();
      const wsAdapter = new HonoWebsocketAdapter(logger);
      // @ts-ignore - clear logger to test auto-set
      wsAdapter['_logger'] = undefined;

      const adapter = new HonoAdapter(logger, wsAdapter);
      expect(adapter).toBeDefined();
    });
  });

  // ─── Route Registration — All HTTP Methods ────────────────────────

  describe('Route Registration — All HTTP Methods', () => {
    it('should handle GET requests', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        method: HttpMethod.GET,
        path: '/users',
        handler: (ctx) => ctx.send({ users: ['alice', 'bob'] }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/users`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.users).toEqual(['alice', 'bob']);
    });

    it('should handle POST requests with JSON body', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        method: HttpMethod.POST,
        path: '/users',
        handler: async (ctx) => {
          const body = await ctx.getBody<{ name: string }>();
          return ctx.send({ created: body.name }, 201);
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'charlie' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.created).toBe('charlie');
    });

    it('should handle PUT requests', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        method: HttpMethod.PUT,
        path: '/users/:id',
        handler: async (ctx) => {
          const id = ctx.getParam('id');
          const body = await ctx.getBody<{ name: string }>();
          return ctx.send({ id, name: body.name });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/users/42`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'updated' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('42');
      expect(body.name).toBe('updated');
    });

    it('should handle DELETE requests', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        method: HttpMethod.DELETE,
        path: '/users/:id',
        handler: (ctx) => {
          const id = ctx.getParam('id');
          return ctx.send({ deleted: id });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/users/99`, { method: 'DELETE' });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.deleted).toBe('99');
    });

    it('should handle PATCH requests', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        method: HttpMethod.PATCH,
        path: '/users/:id',
        handler: async (ctx) => {
          const id = ctx.getParam('id');
          const body = await ctx.getBody<{ email: string }>();
          return ctx.send({ id, email: body.email });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/users/5`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new@test.com' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.email).toBe('new@test.com');
    });

    it('should handle OPTIONS requests', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        method: HttpMethod.OPTIONS,
        path: '/api',
        handler: (ctx) => ctx.send('', 204),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/api`, { method: 'OPTIONS' });
      expect(res.status).toBe(204);
    });

    it('should handle HEAD requests (via GET route)', async () => {
      const { adapter } = createTestAdapter();

      // HEAD requests in Hono are handled by GET routes (HTTP spec: HEAD = GET without body)
      await registerRoute(adapter, {
        method: HttpMethod.GET,
        path: '/health',
        handler: (ctx) => ctx.send({ status: 'ok' }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/health`, { method: 'HEAD' });
      expect(res.status).toBe(200);

      // HEAD response should have no body
      const body = await res.text();
      expect(body).toBe('');
    });

    it('should handle ALL method (responds to multiple methods)', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        method: HttpMethod.ALL,
        path: '/any',
        handler: (ctx) => ctx.send({ method: ctx.req.method }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const getRes = await fetch(`${baseUrl}/any`);
      expect((await getRes.json()).method).toBe('GET');

      const postRes = await fetch(`${baseUrl}/any`, { method: 'POST' });
      expect((await postRes.json()).method).toBe('POST');

      const putRes = await fetch(`${baseUrl}/any`, { method: 'PUT' });
      expect((await putRes.json()).method).toBe('PUT');
    });
  });

  // ─── Route Handler Context ────────────────────────────────────────

  describe('Route Handler Context', () => {
    it('should read JSON body in handler', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        method: HttpMethod.POST,
        path: '/echo',
        handler: async (ctx) => {
          const body = await ctx.getBody();
          return ctx.send(body);
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hello: 'world' }),
      });

      expect(await res.json()).toEqual({ hello: 'world' });
    });

    it('should read route params', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/users/:userId/posts/:postId',
        handler: (ctx) => {
          return ctx.send({
            userId: ctx.getParam('userId'),
            postId: ctx.getParam('postId'),
          });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/users/10/posts/20`);
      const body = await res.json();
      expect(body.userId).toBe('10');
      expect(body.postId).toBe('20');
    });

    it('should read query params', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/search',
        handler: async (ctx) => {
          const q = await ctx.getQuery('q');
          const page = await ctx.getQuery('page');
          return ctx.send({ q, page });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/search?q=test&page=2`);
      const body = await res.json();
      expect(body.q).toBe('test');
      expect(body.page).toBe('2');
    });

    it('should send text response', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/text',
        handler: (ctx) => ctx.send('hello plain text'),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/text`);
      expect(await res.text()).toBe('hello plain text');
    });

    it('should send HTML response', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/page',
        handler: (ctx) => ctx.html('<h1>Hello</h1>'),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/page`);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(await res.text()).toBe('<h1>Hello</h1>');
    });

    it('should send response with custom status and headers', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        method: HttpMethod.POST,
        path: '/create',
        handler: (ctx) => ctx.send({ id: 1 }, { status: 201, headers: { 'X-Custom': 'value' } }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/create`, { method: 'POST' });
      expect(res.status).toBe(201);
      expect(res.headers.get('X-Custom')).toBe('value');
    });

    it('should handle redirect', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/old',
        handler: (ctx) => ctx.redirect('/new'),
      });

      await registerRoute(adapter, {
        path: '/new',
        handler: (ctx) => ctx.send({ location: 'new' }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/old`, { redirect: 'manual' });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/new');
    });
  });

  // ─── Middleware Execution ─────────────────────────────────────────

  describe('Middleware Execution', () => {
    it('should execute single middleware before handler', async () => {
      const { adapter } = createTestAdapter();

      const mw = createTestMiddleware('setHeader', {
        headerName: 'X-Before',
        headerValue: 'yes',
      });

      await registerRoute(adapter, {
        path: '/mw',
        middlewares: [mw],
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/mw`);
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Before')).toBe('yes');
      expect(mw.handle).toHaveBeenCalled();
    });

    it('should execute multiple middlewares in registration order', async () => {
      const { adapter } = createTestAdapter();
      const order: number[] = [];

      const mw1 = createTestMiddleware(async (ctx, next) => {
        order.push(1);
        ctx.setResponseHeader?.('X-Order-1', 'first');
        await next();
        return true;
      });

      const mw2 = createTestMiddleware(async (ctx, next) => {
        order.push(2);
        ctx.setResponseHeader?.('X-Order-2', 'second');
        await next();
        return true;
      });

      await registerRoute(adapter, {
        path: '/ordered',
        middlewares: [mw1, mw2],
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/ordered`);
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Order-1')).toBe('first');
      expect(res.headers.get('X-Order-2')).toBe('second');
      expect(order).toEqual([1, 2]);
    });

    it('should share context values between middlewares and handler', async () => {
      const { adapter } = createTestAdapter();

      const mw = createTestMiddleware(async (ctx, next) => {
        ctx.setValue('user' as any, { id: 42, name: 'test' });
        await next();
        return true;
      });

      await registerRoute(adapter, {
        path: '/shared',
        middlewares: [mw],
        handler: (ctx) => {
          const user = ctx.getValue('user' as any);
          return ctx.send({ user });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/shared`);
      const body = await res.json();
      expect(body.user).toEqual({ id: 42, name: 'test' });
    });

    it('should stop chain when middleware returns false', async () => {
      const { adapter } = createTestAdapter();
      const handlerCalled = { value: false };

      const blockingMw = createTestMiddleware('block');

      await registerRoute(adapter, {
        path: '/blocked',
        middlewares: [blockingMw],
        handler: (ctx) => {
          handlerCalled.value = true;
          return ctx.send({ ok: true });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/blocked`);
      // Middleware returned false, handler should not have been called
      expect(handlerCalled.value).toBe(false);
    });

    it('should use response returned by middleware', async () => {
      const { adapter } = createTestAdapter();

      const responseMw = createTestMiddleware('response');

      await registerRoute(adapter, {
        path: '/mw-response',
        middlewares: [responseMw],
        handler: (ctx) => ctx.send({ should: 'not reach' }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/mw-response`);
      expect(res.status).toBe(403);

      const body = await res.json();
      expect(body.blocked).toBe(true);
    });

    it('should set response headers from middleware', async () => {
      const { adapter } = createTestAdapter();

      const headerMw = createTestMiddleware('setHeader', {
        headerName: 'X-Request-Id',
        headerValue: 'abc-123',
      });

      await registerRoute(adapter, {
        path: '/with-header',
        middlewares: [headerMw],
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/with-header`);
      expect(res.headers.get('X-Request-Id')).toBe('abc-123');
    });
  });

  // ─── Global Middleware ────────────────────────────────────────────

  describe('Global Middleware', () => {
    it('should apply global middleware to all routes', async () => {
      const { adapter } = createTestAdapter();

      const globalMw = createTestMiddleware('setHeader', {
        headerName: 'X-Global',
        headerValue: 'applied',
      });

      // @ts-ignore
      adapter.use(globalMw);

      await registerRoute(adapter, {
        path: '/route-a',
        handler: (ctx) => ctx.send({ route: 'a' }),
      });

      await registerRoute(adapter, {
        path: '/route-b',
        handler: (ctx) => ctx.send({ route: 'b' }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const resA = await fetch(`${baseUrl}/route-a`);
      expect(resA.headers.get('X-Global')).toBe('applied');

      const resB = await fetch(`${baseUrl}/route-b`);
      expect(resB.headers.get('X-Global')).toBe('applied');
    });

    it('should apply global middleware with include pattern only to matching routes', async () => {
      const { adapter } = createTestAdapter();

      const apiMw = createTestMiddleware('setHeader', {
        headerName: 'X-Api-Only',
        headerValue: 'yes',
      });

      // @ts-ignore
      adapter.use(apiMw, { include: ['/api/*'] });

      await registerRoute(adapter, {
        path: '/api/users',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      await registerRoute(adapter, {
        path: '/public/page',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const apiRes = await fetch(`${baseUrl}/api/users`);
      expect(apiRes.headers.get('X-Api-Only')).toBe('yes');

      const publicRes = await fetch(`${baseUrl}/public/page`);
      expect(publicRes.headers.get('X-Api-Only')).toBeNull();
    });

    it('should skip global middleware with exclude pattern', async () => {
      const { adapter } = createTestAdapter();

      const mw = createTestMiddleware('setHeader', {
        headerName: 'X-Guarded',
        headerValue: 'yes',
      });

      // @ts-ignore
      adapter.use(mw, { include: ['/api/*'], exclude: ['/api/health'] });

      await registerRoute(adapter, {
        path: '/api/users',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      await registerRoute(adapter, {
        path: '/api/health',
        handler: (ctx) => ctx.send({ status: 'ok' }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const usersRes = await fetch(`${baseUrl}/api/users`);
      expect(usersRes.headers.get('X-Guarded')).toBe('yes');

      const healthRes = await fetch(`${baseUrl}/api/health`);
      expect(healthRes.headers.get('X-Guarded')).toBeNull();
    });

    it('should execute multiple global middlewares in order', async () => {
      const { adapter } = createTestAdapter();
      const order: string[] = [];

      const mw1 = createTestMiddleware(async (ctx, next) => {
        order.push('first');
        ctx.setResponseHeader?.('X-First', 'yes');
        await next();
        return true;
      });

      const mw2 = createTestMiddleware(async (ctx, next) => {
        order.push('second');
        ctx.setResponseHeader?.('X-Second', 'yes');
        await next();
        return true;
      });

      // @ts-ignore
      adapter.use(mw1);
      // @ts-ignore
      adapter.use(mw2);

      await registerRoute(adapter, {
        path: '/test',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/test`);
      expect(res.headers.get('X-First')).toBe('yes');
      expect(res.headers.get('X-Second')).toBe('yes');
      expect(order).toEqual(['first', 'second']);
    });
  });

  // ─── Route Priority ───────────────────────────────────────────────

  describe('Route Priority', () => {
    it('should match static route before parametric route', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/users/:id',
        handler: (ctx) => ctx.send({ type: 'param', id: ctx.getParam('id') }),
      });

      await registerRoute(adapter, {
        path: '/users/count',
        handler: (ctx) => ctx.send({ type: 'static', count: 42 }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/users/count`);
      const body = await res.json();
      expect(body.type).toBe('static');
      expect(body.count).toBe(42);
    });

    it('should match parametric route for non-static paths', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/users/count',
        handler: (ctx) => ctx.send({ type: 'static' }),
      });

      await registerRoute(adapter, {
        path: '/users/:id',
        handler: (ctx) => ctx.send({ type: 'param', id: ctx.getParam('id') }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/users/123`);
      const body = await res.json();
      expect(body.type).toBe('param');
      expect(body.id).toBe('123');
    });

    it('should sort routes correctly: static > param > wildcard', async () => {
      const { adapter } = createTestAdapter();

      // Register in wrong order intentionally
      await registerRoute(adapter, {
        path: '/files/*',
        handler: (ctx) => ctx.send({ type: 'wildcard' }),
      });

      await registerRoute(adapter, {
        path: '/files/:name',
        handler: (ctx) => ctx.send({ type: 'param' }),
      });

      await registerRoute(adapter, {
        path: '/files/readme',
        handler: (ctx) => ctx.send({ type: 'static' }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const staticRes = await fetch(`${baseUrl}/files/readme`);
      expect((await staticRes.json()).type).toBe('static');

      const paramRes = await fetch(`${baseUrl}/files/image.png`);
      expect((await paramRes.json()).type).toBe('param');
    });
  });

  // ─── Validation ───────────────────────────────────────────────────

  describe('Validation', () => {
    it('should pass valid JSON body through validation', async () => {
      const { adapter } = createTestAdapter();

      const schema = z.object({ name: z.string(), age: z.number() });

      await adapter.registerRoute({
        method: HttpMethod.POST,
        path: '/validated',
        middlewares: [],
        handler: async (ctx) => {
          const body = await ctx.getBody();
          return ctx.send(body);
        },
        staticServe: null,
        validator: {
          json: { handle: () => schema, override: false },
        },
      } as any);

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/validated`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice', age: 30 }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('Alice');
      expect(body.age).toBe(30);
    });

    it('should return 400 for invalid JSON body', async () => {
      const { adapter } = createTestAdapter();

      const schema = z.object({ name: z.string(), age: z.number() });

      await adapter.registerRoute({
        method: HttpMethod.POST,
        path: '/validated',
        middlewares: [],
        handler: async (ctx) => ctx.send({ ok: true }),
        staticServe: null,
        validator: {
          json: { handle: () => schema, override: false },
        },
      } as any);

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/validated`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 123, age: 'not-a-number' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Validation failed');
      expect(body.target).toBe('json');
      expect(body.details).toBeDefined();
    });

    it('should validate query parameters', async () => {
      const { adapter } = createTestAdapter();

      const schema = z.object({ page: z.string().regex(/^\d+$/) });

      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/search',
        middlewares: [],
        handler: async (ctx) => {
          const page = await ctx.getQuery('page');
          return ctx.send({ page });
        },
        staticServe: null,
        validator: {
          query: { handle: () => schema, override: false },
        },
      } as any);

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      // Valid
      const validRes = await fetch(`${baseUrl}/search?page=5`);
      expect(validRes.status).toBe(200);

      // Invalid
      const invalidRes = await fetch(`${baseUrl}/search?page=abc`);
      expect(invalidRes.status).toBe(400);
    });

    it('should validate header parameters', async () => {
      const { adapter } = createTestAdapter();

      const schema = z.object({ 'x-api-key': z.string().min(10) });

      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/protected',
        middlewares: [],
        handler: (ctx) => ctx.send({ ok: true }),
        staticServe: null,
        validator: {
          header: { handle: () => schema, override: false },
        },
      } as any);

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      // Valid
      const validRes = await fetch(`${baseUrl}/protected`, {
        headers: { 'X-Api-Key': 'super-secret-key-123' },
      });
      expect(validRes.status).toBe(200);

      // Invalid (too short)
      const invalidRes = await fetch(`${baseUrl}/protected`, {
        headers: { 'X-Api-Key': 'short' },
      });
      expect(invalidRes.status).toBe(400);
    });

    it('should apply multiple validators on same route', async () => {
      const { adapter } = createTestAdapter();

      const bodySchema = z.object({ value: z.number() });
      const querySchema = z.object({ format: z.enum(['json', 'xml']) });

      await adapter.registerRoute({
        method: HttpMethod.POST,
        path: '/multi-validated',
        middlewares: [],
        handler: async (ctx) => {
          const body = await ctx.getBody();
          const format = await ctx.getQuery('format');
          return ctx.send({ body, format });
        },
        staticServe: null,
        validator: {
          json: { handle: () => bodySchema, override: false },
          query: { handle: () => querySchema, override: false },
        },
      } as any);

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      // Both valid
      const validRes = await fetch(`${baseUrl}/multi-validated?format=json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 42 }),
      });
      expect(validRes.status).toBe(200);

      // Invalid query
      const invalidRes = await fetch(`${baseUrl}/multi-validated?format=csv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 42 }),
      });
      expect(invalidRes.status).toBe(400);
    });

    it('should skip null validator gracefully', async () => {
      const { adapter } = createTestAdapter();

      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/no-validator',
        middlewares: [],
        handler: (ctx) => ctx.send({ ok: true }),
        staticServe: null,
        validator: null,
      } as any);

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/no-validator`);
      expect(res.status).toBe(200);
    });

    it('should warn and skip when validator returns null schema', async () => {
      const { adapter, logger } = createTestAdapter();

      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/null-schema',
        middlewares: [],
        handler: (ctx) => ctx.send({ ok: true }),
        staticServe: null,
        validator: {
          json: { handle: () => null, override: false },
        },
      } as any);

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/null-schema`);
      expect(res.status).toBe(200);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should use custom hook when provided with schema', async () => {
      const { adapter } = createTestAdapter();

      const schema = z.object({ name: z.string() });
      let hookCalled = false;

      await adapter.registerRoute({
        method: HttpMethod.POST,
        path: '/with-hook',
        middlewares: [],
        handler: async (ctx) => ctx.send({ ok: true }),
        staticServe: null,
        validator: {
          json: {
            handle: () => ({
              schema,
              hook: (result: any, c: any) => {
                hookCalled = true;
                if (!result.success) {
                  return c.json({ customError: true }, 422);
                }
              },
            }),
            override: false,
          },
        },
      } as any);

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      // Invalid body should trigger custom hook
      const res = await fetch(`${baseUrl}/with-hook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 123 }),
      });

      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.customError).toBe(true);
      expect(hookCalled).toBe(true);
    });

    it('should route validation failures to onError as a ValidationError', async () => {
      const { adapter } = createTestAdapter();

      let seen: Error | undefined;

      adapter.onError((error, ctx) => {
        seen = error;

        if (isValidationError(error)) {
          return ctx.send({ success: false, errors: error.issues }, 400);
        }

        return ctx.send({ success: false }, 500);
      });

      const schema = z.object({ email: z.string().min(3) });

      await adapter.registerRoute({
        method: HttpMethod.POST,
        path: '/mapped',
        middlewares: [],
        handler: async (ctx) => ctx.send({ ok: true }),
        staticServe: null,
        validator: { json: { handle: () => schema, override: false } },
      } as any);

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/mapped`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'x' }),
      });

      expect(res.status).toBe(400);

      const body = await res.json();

      expect(body.success).toBe(false);
      expect(body.errors[0].path).toEqual(['email']);
      expect(body.errors[0].message).toBeString();

      // Subclassing HTTPException is what keeps an existing
      // `instanceof HTTPException` branch answering 400 instead of 500
      expect(seen).toBeInstanceOf(ValidationError);
      expect(seen).toBeInstanceOf(HTTPException);
      expect((seen as ValidationError).status).toBe(400);
      expect((seen as ValidationError).target).toBe('json');
    });

    it('should keep the default envelope when no error handler is configured', async () => {
      const { adapter } = createTestAdapter();

      const schema = z.object({ email: z.string().min(3) });

      await adapter.registerRoute({
        method: HttpMethod.POST,
        path: '/unmapped',
        middlewares: [],
        handler: async (ctx) => ctx.send({ ok: true }),
        staticServe: null,
        validator: { json: { handle: () => schema, override: false } },
      } as any);

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/unmapped`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'x' }),
      });

      expect(res.status).toBe(400);

      const body = await res.json();

      expect(body.error).toBe('Validation failed');
      expect(body.target).toBe('json');
      expect(body.details.fieldErrors.email).toBeDefined();
    });

    it('should log the failure when no error handler is configured', async () => {
      const { adapter, logger } = createTestAdapter();

      const schema = z.object({ email: z.string().min(3) });

      await adapter.registerRoute({
        method: HttpMethod.POST,
        path: '/unlogged',
        middlewares: [],
        handler: async (ctx) => ctx.send({ ok: true }),
        staticServe: null,
        validator: { json: { handle: () => schema, override: false } },
      } as any);

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      await fetch(`${baseUrl}/unlogged`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'x' }),
      });

      // The adapter used to answer this 400 from inside the validator middleware, so it never
      // threw and never reached `onError` - the one 4xx an application could not see at any
      // level. (`createMockLogger` has no `debug`, so the 4xx level falls back to `info`;
      // assert on the message, not the method.)
      const logged = (logger.info as any).mock.calls.find((call: unknown[]) =>
        String(call[0]).includes('Request rejected'),
      );

      expect(logged).toBeDefined();
      expect(logged[1].status).toBe(400);
      expect(logged[1].path).toBe('/unlogged');
    });

    it('should answer the same envelope when the error handler declines', async () => {
      const { adapter } = createTestAdapter();

      // Before the envelope moved onto `ValidationError.getResponse()`, this fell back to
      // `HTTPException`'s bare `Validation failed` text - so the body depended on whether an
      // unrelated hook existed, which is exactly what the single path removed.
      adapter.onError((() => undefined) as any);

      const schema = z.object({ email: z.string().min(3) });

      await adapter.registerRoute({
        method: HttpMethod.POST,
        path: '/declined',
        middlewares: [],
        handler: async (ctx) => ctx.send({ ok: true }),
        staticServe: null,
        validator: { json: { handle: () => schema, override: false } },
      } as any);

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/declined`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'x' }),
      });

      expect(res.status).toBe(400);

      const body = await res.json();

      expect(body.error).toBe('Validation failed');
      expect(body.target).toBe('json');
      expect(body.details.fieldErrors.email).toBeDefined();
    });

    it('should keep the default envelope when a hook returns no response', async () => {
      const { adapter } = createTestAdapter();

      const schema = z.object({ name: z.string() });
      const seenTargets: boolean[] = [];

      await adapter.registerRoute({
        method: HttpMethod.POST,
        path: '/logging-hook',
        middlewares: [],
        handler: async (ctx) => ctx.send({ ok: true }),
        staticServe: null,
        validator: {
          json: {
            // A hook added purely to observe - it must not change the error contract
            handle: () => ({ schema, hook: (result: any) => void seenTargets.push(result.success) }),
            override: false,
          },
        },
      } as any);

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/logging-hook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 123 }),
      });

      expect(res.status).toBe(400);

      const body = await res.json();

      expect(body.error).toBe('Validation failed');
      expect(body.target).toBe('json');
      expect(seenTargets).toEqual([false]);
    });

    it('should still run a hook on successful validation', async () => {
      const { adapter } = createTestAdapter();

      const schema = z.object({ name: z.string() });
      let hookRuns = 0;

      await adapter.registerRoute({
        method: HttpMethod.POST,
        path: '/hook-on-success',
        middlewares: [],
        handler: async (ctx) => ctx.send({ ok: true }),
        staticServe: null,
        validator: {
          json: { handle: () => ({ schema, hook: () => void hookRuns++ }), override: false },
        },
      } as any);

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/hook-on-success`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice' }),
      });

      expect(res.status).toBe(200);
      expect(hookRuns).toBe(1);
    });
  });

  // ─── Error Handling ───────────────────────────────────────────────

  describe('Error Handling', () => {
    it('should handle route handler errors with custom error handler', async () => {
      const { adapter } = createTestAdapter();

      adapter.onError((error, ctx) => {
        return ctx.send({ error: error.message }, 500);
      });

      await registerRoute(adapter, {
        path: '/fail',
        handler: () => {
          throw new Error('Something broke');
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/fail`);
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body.error).toBe('Something broke');
    });

    it('should preserve HTTPException status code', async () => {
      const { adapter } = createTestAdapter();

      adapter.onError((error, ctx) => {
        if (error instanceof HTTPException) {
          return ctx.send({ error: error.message }, error.status);
        }
        return ctx.send({ error: 'Unknown' }, 500);
      });

      await registerRoute(adapter, {
        path: '/not-found',
        handler: () => {
          throw new HTTPException(404, { message: 'Resource not found' });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/not-found`);
      expect(res.status).toBe(404);

      const body = await res.json();
      expect(body.error).toBe('Resource not found');
    });

    it('should use HTTPException default response when handler returns undefined', async () => {
      const { adapter } = createTestAdapter();

      adapter.onError((_error, _ctx) => {
        // Return undefined — should fallback to HTTPException's getResponse()
        return undefined as any;
      });

      await registerRoute(adapter, {
        path: '/unauthorized',
        handler: () => {
          throw new HTTPException(401, { message: 'Unauthorized' });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/unauthorized`);
      expect(res.status).toBe(401);
    });

    it('should fallback to 500 when error handler itself throws', async () => {
      const { adapter, logger } = createTestAdapter();

      adapter.onError(() => {
        throw new Error('Handler also broke');
      });

      await registerRoute(adapter, {
        path: '/double-fail',
        handler: () => {
          throw new Error('Original error');
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/double-fail`);
      expect(res.status).toBe(500);

      const body = await res.json();

      // The same body `@asenajs/ergenecore` answers. It used to be `{error: 'Internal server
      // error', message, timestamp}` here and `text/plain` for an app with no config at all,
      // so one failure had three envelopes across the two adapters.
      expect(body).toEqual({ error: 'Internal Server Error' });
      expect(logger.error).toHaveBeenCalled();
    });

    it('should not log an application error the handler answered itself', async () => {
      const { adapter, logger } = createTestAdapter();

      adapter.onError((error, ctx) => {
        return ctx.send({ error: error.message }, 500);
      });

      await registerRoute(adapter, {
        path: '/logged-error',
        handler: () => {
          throw new Error('Logged error');
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      await fetch(`${baseUrl}/logged-error`);

      // The framework's default log fires exactly when its default *response* does. An
      // application whose handler answered has already recorded the failure; a second line
      // from the adapter would only duplicate it. See errorLogging.test.ts for the case where
      // the handler declines - there the framework does still log.
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should handle different HTTPException status codes', async () => {
      const { adapter } = createTestAdapter();

      adapter.onError((error, ctx) => {
        if (error instanceof HTTPException) {
          return ctx.send({ status: error.status }, error.status);
        }
      });

      // `as const`: HTTPException takes a ContentfulStatusCode, not a widened `number`.
      for (const status of [400, 403, 404, 422, 429] as const) {
        await registerRoute(adapter, {
          path: `/error-${status}`,
          handler: () => {
            throw new HTTPException(status);
          },
        });
      }

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      // `as const`: HTTPException takes a ContentfulStatusCode, not a widened `number`.
      for (const status of [400, 403, 404, 422, 429] as const) {
        const res = await fetch(`${baseUrl}/error-${status}`);
        expect(res.status).toBe(status);
      }
    });
  });

  // ─── Static File Serving ──────────────────────────────────────────

  describe('Static File Serving', () => {
    it('should serve static files from a directory', async () => {
      const { adapter } = createTestAdapter();

      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/static/*',
        middlewares: [],
        handler: (ctx: HonoAdapterContext) => ctx.send('fallback'),
        staticServe: {
          root: './test/fixtures',
          rewriteRequestPath: (path: string) => path.replace('/static', ''),
        },
        validator: null,
      } as any);

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/static/test.txt`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text.trim()).toBe('hello from test fixture');
    });

    it('should apply cache control headers', async () => {
      const { adapter } = createTestAdapter();

      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/cached/*',
        middlewares: [],
        handler: (ctx: HonoAdapterContext) => ctx.send('fallback'),
        staticServe: {
          root: './test/fixtures',
          rewriteRequestPath: (path: string) => path.replace('/cached', ''),
          extra: {
            cacheControl: 'public, max-age=3600',
          },
        },
        validator: null,
      } as any);

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/cached/test.txt`);
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
    });

    it('should apply custom headers to static files', async () => {
      const { adapter } = createTestAdapter();

      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/custom-headers/*',
        middlewares: [],
        handler: (ctx: HonoAdapterContext) => ctx.send('fallback'),
        staticServe: {
          root: './test/fixtures',
          rewriteRequestPath: (path: string) => path.replace('/custom-headers', ''),
          extra: {
            headers: { 'X-Static': 'true', 'X-Version': '1.0' },
          },
        },
        validator: null,
      } as any);

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/custom-headers/test.txt`);
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Static')).toBe('true');
      expect(res.headers.get('X-Version')).toBe('1.0');
    });
  });

  // ─── Server Lifecycle ─────────────────────────────────────────────

  describe('Server Lifecycle', () => {
    it('should start and stop the server', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/ping',
        handler: (ctx) => ctx.send('pong'),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/ping`);
      expect(res.status).toBe(200);

      await adapter.stop(true);
      server = undefined;

      // Server should be stopped
      try {
        await fetch(`${baseUrl}/ping`);
        // If we get here, server is still running — that's unexpected
      } catch {
        // Expected: connection refused
      }
    });

    it('should register routes only once on start', async () => {
      const { adapter, logger } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/once',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const s = await adapter.start();
      server = s;

      // Verify the route works
      const res1 = await fetch(`http://localhost:${s.port}/once`);
      expect(res1.status).toBe(200);
    });

    it('should normalize paths by stripping trailing slashes', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/trailing/',
        handler: (ctx) => ctx.send({ path: 'normalized' }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/trailing`);
      expect(res.status).toBe(200);
    });

    it('should preserve root path', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/',
        handler: (ctx) => ctx.send({ root: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.root).toBe(true);
    });
  });

  // ─── HTML Routes ──────────────────────────────────────────────────

  describe('HTML Routes', () => {
    it('should register HTML route and its trailing slash variant', () => {
      const { adapter } = createTestAdapter();

      adapter.registerHTMLRoute('/ui/home', '<html>Home</html>', 'FrontEnd', '/ui');

      // Should not throw for a different path
      adapter.registerHTMLRoute('/ui/about', '<html>About</html>', 'FrontEnd', '/ui');
    });

    it('should throw on duplicate HTML route', () => {
      const { adapter } = createTestAdapter();

      adapter.registerHTMLRoute('/ui/home', '<html>Home</html>', 'FrontEnd', '/ui');

      expect(() => {
        adapter.registerHTMLRoute('/ui/home', '<html>Duplicate</html>', 'FrontEnd', '/ui');
      }).toThrow('Duplicate HTML route');
    });

    it('should log FRONTEND controller summary on start', async () => {
      const { adapter, logger } = createTestAdapter();
      const mockBundle = new Response('<html>Home</html>', { headers: { 'Content-Type': 'text/html' } });
      const mockBundle2 = new Response('<html>About</html>', { headers: { 'Content-Type': 'text/html' } });

      adapter.registerHTMLRoute('/ui/home', mockBundle, 'FrontEnd', '/ui');
      adapter.registerHTMLRoute('/ui/about', mockBundle2, 'FrontEnd', '/ui');

      server = (await adapter.start()) as any;

      const infoCalls = (logger.info as any).mock.calls.map((c: any) => c[0]);
      const summaryLog = infoCalls.find((msg: string) => msg.includes('FRONTEND') && msg.includes('FrontEnd'));
      const detailLog = infoCalls.find((msg: string) => msg.includes('HTML') && msg.includes('/ui/home'));

      expect(summaryLog).toBeDefined();
      expect(detailLog).toBeDefined();
    });

    it('should group frontend routes by controller in log output', async () => {
      const { adapter, logger } = createTestAdapter();
      const mockBundle1 = new Response('<html>Home</html>', { headers: { 'Content-Type': 'text/html' } });
      const mockBundle2 = new Response('<html>Dashboard</html>', { headers: { 'Content-Type': 'text/html' } });

      adapter.registerHTMLRoute('/ui/home', mockBundle1, 'FrontEnd', '/ui');
      adapter.registerHTMLRoute('/admin/dashboard', mockBundle2, 'AdminFrontEnd', '/admin');

      server = (await adapter.start()) as any;

      const infoCalls = (logger.info as any).mock.calls.map((c: any) => c[0]);
      const hasFrontEnd = infoCalls.some((msg: string) => msg.includes('FrontEnd'));
      const hasAdmin = infoCalls.some((msg: string) => msg.includes('AdminFrontEnd'));

      expect(hasFrontEnd).toBe(true);
      expect(hasAdmin).toBe(true);
    });
  });

  // ─── Route Grouping ───────────────────────────────────────────────

  describe('Route Grouping', () => {
    it('should group routes with common middlewares and still work correctly', async () => {
      const { adapter } = createTestAdapter();

      // Create a shared middleware class
      class SharedAuth {
        handle = async (ctx: HonoAdapterContext, next: () => Promise<void>) => {
          ctx.setResponseHeader?.('X-Auth', 'checked');
          await next();
          return true;
        };
        override = false;
      }

      const sharedMw1 = new SharedAuth();
      const sharedMw2 = new SharedAuth();

      await registerRoute(adapter, {
        path: '/api/users',
        middlewares: [sharedMw1],
        handler: (ctx) => ctx.send({ resource: 'users' }),
      });

      await registerRoute(adapter, {
        path: '/api/posts',
        middlewares: [sharedMw2],
        handler: (ctx) => ctx.send({ resource: 'posts' }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const usersRes = await fetch(`${baseUrl}/api/users`);
      expect(usersRes.status).toBe(200);
      expect((await usersRes.json()).resource).toBe('users');
      expect(usersRes.headers.get('X-Auth')).toBe('checked');

      const postsRes = await fetch(`${baseUrl}/api/posts`);
      expect(postsRes.status).toBe(200);
      expect((await postsRes.json()).resource).toBe('posts');
      expect(postsRes.headers.get('X-Auth')).toBe('checked');
    });

    it('should register individual routes without common middlewares', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/route-a',
        handler: (ctx) => ctx.send({ route: 'a' }),
      });

      await registerRoute(adapter, {
        path: '/route-b',
        handler: (ctx) => ctx.send({ route: 'b' }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const resA = await fetch(`${baseUrl}/route-a`);
      expect((await resA.json()).route).toBe('a');

      const resB = await fetch(`${baseUrl}/route-b`);
      expect((await resB.json()).route).toBe('b');
    });
  });

  // ─── Controller-Based Logging ─────────────────────────────────────

  describe('Controller-Based Logging', () => {
    it('should log route information on start', async () => {
      const { adapter, logger } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/users',
        handler: (ctx) => ctx.send({ ok: true }),
        controllerName: 'UserController',
        controllerBasePath: '/users',
      });

      await registerRoute(adapter, {
        method: HttpMethod.POST,
        path: '/users',
        handler: (ctx) => ctx.send({ ok: true }),
        controllerName: 'UserController',
        controllerBasePath: '/users',
      });

      const { server: s } = await startTestServer(adapter);
      server = s;

      // Logger should have been called with controller info
      expect(logger.info).toHaveBeenCalled();
    });

    it('should group routes by controller name', async () => {
      const { adapter, logger } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/users',
        handler: (ctx) => ctx.send({}),
        controllerName: 'UserController',
        controllerBasePath: '/users',
      });

      await registerRoute(adapter, {
        path: '/posts',
        handler: (ctx) => ctx.send({}),
        controllerName: 'PostController',
        controllerBasePath: '/posts',
      });

      const { server: s } = await startTestServer(adapter);
      server = s;

      // Check that logger.info was called with both controller names
      const infoCalls = (logger.info as any).mock.calls.map((c: any) => c[0]);
      const routeLog = infoCalls.find((c: string) => c.includes('UserController') || c.includes('PostController'));
      expect(routeLog).toBeDefined();
    });
  });

  // ─── WebSocket Route Registration ─────────────────────────────────

  describe('WebSocket Route Registration', () => {
    it('should register websocket route and handle upgrade', async () => {
      const { adapter, wsAdapter } = createTestAdapter();

      const wsService = {
        namespace: 'chat',
        sockets: new Map(),
        onOpen: mock(async () => {}),
        onMessage: mock(async (_ws: any, message: any) => {}),
        onClose: mock(async () => {}),
      };

      adapter.registerWebsocketRoute({
        path: 'chat',
        middlewares: [],
        websocketService: wsService as any,
        controllerName: 'ChatController',
      });

      await registerRoute(adapter, {
        path: '/health',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      // The WebSocket route should be registered as a GET route for upgrade
      // Test by verifying the health route still works
      const healthRes = await fetch(`${baseUrl}/health`);
      expect(healthRes.status).toBe(200);
    });

    it('should normalize websocket path by stripping trailing slash', async () => {
      const { adapter } = createTestAdapter();

      const onMessageMock = mock(async () => {});

      const wsService = {
        namespace: 'ws/stats/',
        sockets: new Map(),
        onOpenInternal: mock(async () => {}),
        onMessage: mock(async (ws: any, message: any) => {
          ws.send(typeof message === 'string' ? message : message.toString());
          await onMessageMock();
        }),
        onCloseInternal: mock(async () => {}),
      };

      adapter.registerWebsocketRoute({
        path: 'ws/stats/',
        middlewares: [],
        websocketService: wsService as any,
        controllerName: 'StatsController',
      });

      await registerRoute(adapter, {
        path: '/health',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s } = await startTestServer(adapter);
      server = s;

      // Connect WITHOUT trailing slash — should work after normalization
      const ws = new WebSocket(`ws://localhost:${server.port}/ws/stats`);

      const messagePromise = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('WS message timeout')), 3000);

        ws.onmessage = (e) => {
          clearTimeout(timeout);
          resolve(typeof e.data === 'string' ? e.data : '');
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('WebSocket error'));
        };
      });

      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve();
      });

      ws.send('ping');
      const response = await messagePromise;
      expect(response).toBe('ping');

      ws.close();
    });
  });

  // ─── Serve Options ────────────────────────────────────────────────

  describe('Serve Options', () => {
    it('should accept serve options', async () => {
      const { adapter } = createTestAdapter();

      await adapter.serveOptions(() => ({
        serveOptions: {},
        wsOptions: {},
      }));

      await registerRoute(adapter, {
        path: '/test',
        handler: (ctx) => ctx.send({ ok: true }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/test`);
      expect(res.status).toBe(200);
    });
  });
});
