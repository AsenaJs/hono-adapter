import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { HonoAdapter } from '../lib/HonoAdapter';
import { HonoWebsocketAdapter } from '../lib/HonoWebsocketAdapter';
import type { ServerLogger } from '@asenajs/asena/logger';
import { HttpMethod } from '@asenajs/asena/web-types';

// Mock logger
const createMockLogger = (): ServerLogger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  // @ts-ignore
  debug: () => {},
});

describe('Integration Tests', () => {
  let adapter: HonoAdapter;
  let server: any;
  let baseUrl: string;
  const port = 3334;

  beforeAll(async () => {
    const logger = createMockLogger();
    const wsAdapter = new HonoWebsocketAdapter(logger);

    adapter = new HonoAdapter(logger, wsAdapter);
    adapter.setPort(port);

    // Register test routes
    await adapter.registerRoute({
      method: HttpMethod.GET,
      path: '/health',
      middlewares: [],
      handler: (context) => context.send({ status: 'ok' }),
      staticServe: null,
      validator: null,
    });

    await adapter.registerRoute({
      method: HttpMethod.POST,
      path: '/echo',
      middlewares: [],
      handler: async (context) => {
        const body = await context.getBody();

        return context.send(body);
      },
      staticServe: null,
      validator: null,
    });

    await adapter.registerRoute({
      method: HttpMethod.GET,
      path: '/error',
      middlewares: [],
      handler: () => {
        throw new Error('Test error');
      },
      staticServe: null,
      validator: null,
    });

    await adapter.registerRoute({
      method: HttpMethod.GET,
      path: '/users/:id',
      middlewares: [],
      handler: (context) => {
        const id = context.getParam('id');

        return context.send({ userId: id });
      },
      staticServe: null,
      validator: null,
    });

    // Set up error handler
    adapter.onError((error, context) => {
      return context.send({ error: error.message }, 500);
    });

    server = await adapter.start();
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(() => {
    server?.stop();
  });

  it('should respond to GET /health', async () => {
    const response = await fetch(`${baseUrl}/health`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ status: 'ok' });
  });

  it('should echo POST body', async () => {
    const testData = { message: 'Hello World', timestamp: Date.now() };
    const response = await fetch(`${baseUrl}/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testData),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(testData);
  });

  it('should return 404 for non-existent routes', async () => {
    const response = await fetch(`${baseUrl}/nonexistent`);

    expect(response.status).toBe(404);
  });

  it('should handle errors gracefully', async () => {
    const response = await fetch(`${baseUrl}/error`);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toHaveProperty('error');
    expect(data.error).toBe('Test error');
  });

  it('should handle URL parameters', async () => {
    const response = await fetch(`${baseUrl}/users/123`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ userId: '123' });
  });

  it('should handle multiple concurrent requests', async () => {
    const requests = Array.from({ length: 10 }, (_, i) =>
      fetch(`${baseUrl}/users/${i}`).then((r) => r.json()),
    );

    const results = await Promise.all(requests);

    expect(results).toHaveLength(10);
    results.forEach((result, index) => {
      expect(result).toEqual({ userId: String(index) });
    });
  });

  it('should handle large JSON payloads', async () => {
    const largePayload = {
      data: Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        value: `item-${i}`,
        timestamp: Date.now(),
      })),
    };

    const response = await fetch(`${baseUrl}/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(largePayload),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data).toHaveLength(1000);
  });
});

describe('Route Grouping Tests - registerControllerRoutes', () => {
  let adapter: HonoAdapter;
  let server: any;
  let baseUrl: string;
  const port = 3335;

  beforeAll(async () => {
    const logger = createMockLogger();
    const wsAdapter = new HonoWebsocketAdapter(logger);

    adapter = new HonoAdapter(logger, wsAdapter);
    adapter.setPort(port);

    // Mock middleware that adds a value to context
    const mockMiddleware = {
      handle: async (context, next) => {
        context.setValue('middlewareCalled', true);
        // Must call next to continue the middleware chain
        return await next();
      },
      override: false,
    };

    // Register routes individually - deferred routing will optimize them automatically
    await adapter.registerRoute({
      method: HttpMethod.GET,
      path: '/api/products',
      middlewares: [mockMiddleware], // Controller-level middleware
      handler: (context) => {
        return context.send({
          products: ['Product 1', 'Product 2'],
          middlewareCalled: context.getValue('middlewareCalled'),
        });
      },
      staticServe: null,
      validator: null,
    });

    await adapter.registerRoute({
      method: HttpMethod.GET,
      path: '/api/products/:id',
      middlewares: [mockMiddleware],
      handler: (context) => {
        const id = context.getParam('id');

        return context.send({
          productId: id,
          middlewareCalled: context.getValue('middlewareCalled'),
        });
      },
      staticServe: null,
      validator: null,
    });

    await adapter.registerRoute({
      method: HttpMethod.POST,
      path: '/api/products',
      middlewares: [mockMiddleware],
      handler: async (context) => {
        const body = await context.getBody();

        return context.send({
          created: true,
          data: body,
          middlewareCalled: context.getValue('middlewareCalled'),
        });
      },
      staticServe: null,
      validator: null,
    });

    // Also register another route to test multiple groups
    await adapter.registerRoute({
      method: HttpMethod.GET,
      path: '/api/orders',
      middlewares: [],
      handler: (context) => context.send({ orders: [] }),
      staticServe: null,
      validator: null,
    });

    server = await adapter.start();
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(() => {
    server?.stop();
  });

  it('should handle grouped route - GET /api/products', async () => {
    const response = await fetch(`${baseUrl}/api/products`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.products).toEqual(['Product 1', 'Product 2']);
    expect(data.middlewareCalled).toBe(true);
  });

  it('should handle grouped route with params - GET /api/products/:id', async () => {
    const response = await fetch(`${baseUrl}/api/products/123`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.productId).toBe('123');
    expect(data.middlewareCalled).toBe(true);
  });

  it('should handle grouped route - POST /api/products', async () => {
    const testData = { name: 'New Product', price: 99.99 };
    const response = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testData),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.created).toBe(true);
    expect(data.data).toEqual(testData);
    expect(data.middlewareCalled).toBe(true);
  });

  it('should handle second route group - GET /api/orders', async () => {
    const response = await fetch(`${baseUrl}/api/orders`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.orders).toEqual([]);
  });

  it('should apply controller middleware to all routes in group', async () => {
    // Test multiple endpoints to ensure middleware is applied to all
    const endpoints = ['/api/products', '/api/products/1', '/api/products/2'];

    for (const endpoint of endpoints) {
      const response = await fetch(`${baseUrl}${endpoint}`);
      const data = await response.json();

      expect(data.middlewareCalled).toBe(true);
    }
  });

  it('should not apply controller middleware to routes outside group', async () => {
    // /api/orders group has no middleware, so middlewareCalled should not be set
    const response = await fetch(`${baseUrl}/api/orders`);
    const data = await response.json();

    expect(data.middlewareCalled).toBeUndefined();
  });
});
