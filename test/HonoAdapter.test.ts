import { describe, expect, it, mock, spyOn } from 'bun:test';
import { HonoAdapter } from '../lib/HonoAdapter';
import { HonoWebsocketAdapter } from '../lib/HonoWebsocketAdapter';
import type { ServerLogger } from '@asenajs/asena/logger';
import { HttpMethod } from '@asenajs/asena/web-types';
import type { AsenaWebSocketService } from '@asenajs/asena/web-socket';
import { z } from 'zod';

// Mock logger for testing
const createMockLogger = (): ServerLogger => ({
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  // @ts-ignore
  debug: mock(() => {}),
});

describe('HonoAdapter', () => {
  // Test adapter creation
  it('should create an adapter instance', () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    expect(adapter).toBeDefined();
    expect(adapter.name).toBe('HonoAdapter');
    expect(adapter.app).toBeDefined();
  });

  // Test middleware registration
  it('should register middleware correctly', () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const middleware = {
      handle: mock(() => (_c, next) => next()),
      override: false,
    };

    adapter.use(middleware);

    // Middleware is now stored in globalMiddlewares array (deferred application)
    expect(adapter['globalMiddlewares']).toHaveLength(1);
    expect(adapter['globalMiddlewares'][0].middleware).toBe(middleware);
  });

  // Test route registration - deferred
  it('should queue routes for deferred registration', async () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const handler = mock(() => {});

    await adapter.registerRoute({
      staticServe: null,
      validator: null,
      method: HttpMethod.GET,
      path: '/test',
      middlewares: [],
      handler,
    });

    // Routes are queued, not immediately registered
    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].path).toBe('/test');
  });

  // Test port setting
  it('should set port correctly', () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    adapter.setPort(3000);
    expect(adapter['port']).toBe(3000);
  });

  // Test error handler registration
  it('should register an error handler', () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const spy = spyOn(adapter.app, 'onError');
    const errorHandler = mock(() => new Response('Error'));

    adapter.onError(errorHandler);

    expect(spy).toHaveBeenCalled();
  });

  // Test HTTP methods - CONNECT
  it('should queue CONNECT method route', async () => {
    const logger = createMockLogger();
    const adapter = new HonoAdapter(logger);
    const handler = mock(() => {});

    await adapter.registerRoute({
      staticServe: null,
      validator: null,
      method: HttpMethod.CONNECT,
      path: '/proxy',
      middlewares: [],
      handler,
    });

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].method).toBe(HttpMethod.CONNECT);
  });

  // Test HTTP methods - HEAD
  it('should queue HEAD method route', async () => {
    const logger = createMockLogger();
    const adapter = new HonoAdapter(logger);
    const handler = mock(() => {});

    await adapter.registerRoute({
      staticServe: null,
      validator: null,
      method: HttpMethod.HEAD,
      path: '/check',
      middlewares: [],
      handler,
    });

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].method).toBe(HttpMethod.HEAD);
  });

  // Test HTTP methods - TRACE
  it('should queue TRACE method route', async () => {
    const logger = createMockLogger();
    const adapter = new HonoAdapter(logger);
    const handler = mock(() => {});

    await adapter.registerRoute({
      staticServe: null,
      validator: null,
      method: HttpMethod.TRACE,
      path: '/trace',
      middlewares: [],
      handler,
    });

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].method).toBe(HttpMethod.TRACE);
  });

  // Test POST method
  it('should queue POST method route', async () => {
    const logger = createMockLogger();
    const adapter = new HonoAdapter(logger);
    const handler = mock(() => {});

    await adapter.registerRoute({
      staticServe: null,
      validator: null,
      method: HttpMethod.POST,
      path: '/create',
      middlewares: [],
      handler,
    });

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].method).toBe(HttpMethod.POST);
  });

  // Test PUT method
  it('should queue PUT method route', async () => {
    const logger = createMockLogger();
    const adapter = new HonoAdapter(logger);
    const handler = mock(() => {});

    await adapter.registerRoute({
      staticServe: null,
      validator: null,
      method: HttpMethod.PUT,
      path: '/update',
      middlewares: [],
      handler,
    });

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].method).toBe(HttpMethod.PUT);
  });

  // Test DELETE method
  it('should queue DELETE method route', async () => {
    const logger = createMockLogger();
    const adapter = new HonoAdapter(logger);
    const handler = mock(() => {});

    await adapter.registerRoute({
      staticServe: null,
      validator: null,
      method: HttpMethod.DELETE,
      path: '/remove',
      middlewares: [],
      handler,
    });

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].method).toBe(HttpMethod.DELETE);
  });

  // Test PATCH method
  it('should queue PATCH method route', async () => {
    const logger = createMockLogger();
    const adapter = new HonoAdapter(logger);
    const handler = mock(() => {});

    await adapter.registerRoute({
      staticServe: null,
      validator: null,
      method: HttpMethod.PATCH,
      path: '/modify',
      middlewares: [],
      handler,
    });

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].method).toBe(HttpMethod.PATCH);
  });

  // Test OPTIONS method
  it('should queue OPTIONS method route', async () => {
    const logger = createMockLogger();
    const adapter = new HonoAdapter(logger);
    const handler = mock(() => {});

    await adapter.registerRoute({
      staticServe: null,
      validator: null,
      method: HttpMethod.OPTIONS,
      path: '/options',
      middlewares: [],
      handler,
    });

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].method).toBe(HttpMethod.OPTIONS);
  });

  // Test global middleware registration without config (apply to all routes)
  it('should register global middleware without config', () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const middleware = {
      handle: mock(() => true),
      override: false,
    };

    adapter.use(middleware);

    // Middleware should be stored in globalMiddlewares array
    expect(adapter['globalMiddlewares']).toHaveLength(1);
    expect(adapter['globalMiddlewares'][0].middleware).toBe(middleware);
    expect(adapter['globalMiddlewares'][0].config).toBeUndefined();
  });

  // Test WebSocket route registration
  it('should register WebSocket route', () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const websocketService = {
      namespace: 'chat',
      onMessage: mock(() => {}),
      onOpenInternal: mock(() => {}),
      onCloseInternal: mock(() => {}),
    } as unknown as AsenaWebSocketService<any>;

    adapter.registerWebsocketRoute({
      path: 'chat',
      websocketService: websocketService as any,
      middlewares: [],
    });

    // WebSocket routes are now queued for deferred registration
    expect(adapter['wsRouteQueue']).toHaveLength(1);
    expect(adapter['wsRouteQueue'][0].path).toBe('chat');
  });

  // Test WebSocket route with middlewares
  it('should register WebSocket route with middlewares', () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const middleware = {
      handle: mock(() => true),
      override: false,
    };

    const websocketService = {
      namespace: 'chat',
      onMessage: mock(() => {}),
    } as unknown as AsenaWebSocketService<any>;

    adapter.registerWebsocketRoute({
      path: 'chat',
      websocketService: websocketService as any,
      middlewares: [middleware],
    });

    // WebSocket routes are now queued with middlewares
    expect(adapter['wsRouteQueue']).toHaveLength(1);
    expect(adapter['wsRouteQueue'][0].middlewares).toHaveLength(1);
    expect(adapter['wsRouteQueue'][0].middlewares[0]).toBe(middleware);
  });

  // Test route group registration
  it('should register route group', async () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const handler = mock(() => {});

    await adapter.registerRoute({
      staticServe: null,
      validator: null,
      method: HttpMethod.GET,
      path: '/api/users',
      middlewares: [],
      handler,
    });

    // Routes are queued for deferred registration
    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].path).toBe('/api/users');
  });

  // Test serveOptions with async function
  it('should set serve options with async function', async () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const options = {
      serveOptions: {
        port: 3000,
        hostname: 'localhost',
        fetch: adapter.app.fetch,
      } as any,
      wsOptions: {
        maxPayloadLength: 1024,
      },
    } as any;

    await adapter.serveOptions(async () => options);

    expect(adapter['options']).toEqual(options);
  });

  // Test serveOptions with sync function
  it('should set serve options with sync function', async () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const options = {
      serveOptions: {
        port: 4000,
        hostname: '0.0.0.0',
        fetch: adapter.app.fetch,
      } as any,
    } as any;

    await adapter.serveOptions(() => options);

    expect(adapter['options']).toEqual(options);
  });

  // Test route with middlewares
  it('should register route with middlewares', async () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const handler = mock(() => {});

    const middleware = {
      handle: mock(async () => true),
      override: false,
    };

    await adapter.registerRoute({
      staticServe: null,
      validator: null,
      method: HttpMethod.GET,
      path: '/protected',
      middlewares: [middleware],
      handler,
    });

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].middlewares).toHaveLength(1);
    // Middleware is wrapped and will be called during request, not during registration
  });

  // Test adapter creates default websocket adapter when none provided
  it('should create default websocket adapter when none provided', () => {
    const logger = createMockLogger();
    const adapter = new HonoAdapter(logger);

    expect(adapter['websocketAdapter']).toBeDefined();
    expect(adapter['websocketAdapter'].name).toBe('HonoWebsocketAdapter');
  });

  // Test websocket adapter logger is set
  it('should set logger on websocket adapter if not set', () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(null as any);

    const adapter = new HonoAdapter(logger, websocketAdapter);

    expect(adapter).toBeDefined();
    expect(websocketAdapter.logger).toBe(logger);
  });

  // Test static serve with basic options
  it('should register static serve route', async () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    await adapter.registerRoute({
      staticServe: {
        root: './public',
      },
      validator: null,
      method: HttpMethod.GET,
      path: '/static/*',
      middlewares: [],
      handler: null,
    } as any);

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].staticServe?.root).toBe('./public');
  });

  // Test static serve with mimes
  it('should register static serve with custom mimes', async () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    await adapter.registerRoute({
      staticServe: {
        root: './public',
        extra: {
          mimes: {
            '.ts': 'text/typescript',
            '.md': 'text/markdown',
          },
        },
      },
      validator: null,
      method: HttpMethod.GET,
      path: '/assets/*',
      middlewares: [],
      handler: null,
    } as any);

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].staticServe?.extra?.mimes).toEqual({
      '.ts': 'text/typescript',
      '.md': 'text/markdown',
    });
  });

  // Test static serve with precompressed
  it('should register static serve with precompressed option', async () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    await adapter.registerRoute({
      staticServe: {
        root: './public',
        extra: {
          precompressed: true,
        },
      },
      validator: null,
      method: HttpMethod.GET,
      path: '/compressed/*',
      middlewares: [],
      handler: null,
    } as any);

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].staticServe?.extra?.precompressed).toBe(true);
  });

  // Test static serve with onFound handler
  it('should register static serve with onFound handler', async () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const onFoundHandler = mock(() => {});

    await adapter.registerRoute({
      staticServe: {
        root: './public',
        onFound: {
          handler: onFoundHandler,
          override: false,
        },
      },
      validator: null,
      method: HttpMethod.GET,
      path: '/files/*',
      middlewares: [],
      handler: null,
    } as any);

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].staticServe?.onFound?.override).toBe(false);
  });

  // Test static serve with onFound override
  it('should register static serve with onFound override', async () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const onFoundHandler = mock(() => {});

    await adapter.registerRoute({
      staticServe: {
        root: './public',
        onFound: {
          handler: onFoundHandler,
          override: true,
        },
      },
      validator: null,
      method: HttpMethod.GET,
      path: '/override/*',
      middlewares: [],
      handler: null,
    } as any);

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].staticServe?.onFound?.override).toBe(true);
  });

  // Test static serve with onNotFound handler
  it('should register static serve with onNotFound handler', async () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const onNotFoundHandler = mock(() => {});

    await adapter.registerRoute({
      staticServe: {
        root: './public',
        onNotFound: {
          handler: onNotFoundHandler,
          override: false,
        },
      },
      validator: null,
      method: HttpMethod.GET,
      path: '/404/*',
      middlewares: [],
      handler: null,
    } as any);

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].staticServe?.onNotFound?.override).toBe(false);
  });

  // Test static serve with onNotFound override
  it('should register static serve with onNotFound override', async () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const onNotFoundHandler = mock(() => {});

    await adapter.registerRoute({
      staticServe: {
        root: './public',
        onNotFound: {
          handler: onNotFoundHandler,
          override: true,
        },
      },
      validator: null,
      method: HttpMethod.GET,
      path: '/404-override/*',
      middlewares: [],
      handler: null,
    } as any);

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].staticServe?.onNotFound?.override).toBe(true);
  });

  // Test static serve with cache control
  it('should register static serve with custom cache control', async () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    await adapter.registerRoute({
      staticServe: {
        root: './public',
        extra: {
          cacheControl: 'public, max-age=3600',
        },
      },
      validator: null,
      method: HttpMethod.GET,
      path: '/cached/*',
      middlewares: [],
      handler: null,
    } as any);

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].staticServe?.extra?.cacheControl).toBe('public, max-age=3600');
  });

  // Test static serve with custom headers
  it('should register static serve with custom headers', async () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    await adapter.registerRoute({
      staticServe: {
        root: './public',
        extra: {
          headers: {
            'X-Custom-Header': 'CustomValue',
            'X-Another-Header': 'AnotherValue',
          },
        },
      },
      validator: null,
      method: HttpMethod.GET,
      path: '/headers/*',
      middlewares: [],
      handler: null,
    } as any);

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].staticServe?.extra?.headers).toEqual({
      'X-Custom-Header': 'CustomValue',
      'X-Another-Header': 'AnotherValue',
    });
  });

  // Test static serve with rewriteRequestPath
  it('should register static serve with rewriteRequestPath', async () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    await adapter.registerRoute({
      staticServe: {
        root: './public',
        rewriteRequestPath: (path: string) => path.replace('/rewrite', ''),
      },
      validator: null,
      method: HttpMethod.GET,
      path: '/rewrite/*',
      middlewares: [],
      handler: null,
    } as any);

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].staticServe?.rewriteRequestPath).toBeTypeOf('function');
  });

  // Test validation with body schema
  it('should register route with body validation', async () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const handler = mock(() => {});

    const validator = {
      body: {
        handle: async () => ({
          schema: z.object({
            email: z.string().email(),
            password: z.string().min(8),
          }),
        }),
      },
    };

    await adapter.registerRoute({
      staticServe: null,
      validator: validator as any,
      method: HttpMethod.POST,
      path: '/login',
      middlewares: [],
      handler,
    });

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].validator).toBeDefined();
    // Validator handle is called during route registration
  });

  // Test validation with schema and hook
  it('should register route with validation schema and hook', async () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const handler = mock(() => {});
    const hookFn = mock(() => {});

    const validator = {
      body: {
        handle: async () => ({
          schema: z.object({
            name: z.string(),
          }),
          hook: hookFn,
        }),
      },
    };

    await adapter.registerRoute({
      staticServe: null,
      validator: validator as any,
      method: HttpMethod.POST,
      path: '/user',
      middlewares: [],
      handler,
    });

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].validator).toBeDefined();
  });

  // Test validation with query params
  it('should register route with query validation', async () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const handler = mock(() => {});

    const validator = {
      query: {
        handle: async () =>
          z.object({
            page: z.string().transform(Number),
            limit: z.string().transform(Number),
          }),
      },
    };

    await adapter.registerRoute({
      staticServe: null,
      validator: validator as any,
      method: HttpMethod.GET,
      path: '/search',
      middlewares: [],
      handler,
    });

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].validator).toBeDefined();
  });

  // Test validation with param
  it('should register route with param validation', async () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const handler = mock(() => {});

    const validator = {
      param: {
        handle: async () =>
          z.object({
            id: z.string().uuid(),
          }),
      },
    };

    await adapter.registerRoute({
      staticServe: null,
      validator: validator as any,
      method: HttpMethod.GET,
      path: '/user/:id',
      middlewares: [],
      handler,
    });

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].validator).toBeDefined();
  });

  // Test validation with header
  it('should register route with header validation', async () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const handler = mock(() => {});

    const validator = {
      header: {
        handle: async () =>
          z.object({
            authorization: z.string(),
          }),
      },
    };

    await adapter.registerRoute({
      staticServe: null,
      validator: validator as any,
      method: HttpMethod.GET,
      path: '/protected',
      middlewares: [],
      handler,
    });

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].validator).toBeDefined();
  });

  // Test validation with cookie
  it('should register route with cookie validation', async () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const handler = mock(() => {});

    const validator = {
      cookie: {
        handle: async () =>
          z.object({
            session: z.string(),
          }),
      },
    };

    await adapter.registerRoute({
      staticServe: null,
      validator: validator as any,
      method: HttpMethod.GET,
      path: '/session',
      middlewares: [],
      handler,
    });

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].validator).toBeDefined();
  });

  // Test validation with multiple targets
  it('should register route with multiple validation targets', async () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const handler = mock(() => {});

    const validator = {
      body: {
        handle: async () => z.object({ data: z.string() }),
      },
      query: {
        handle: async () => z.object({ filter: z.string() }),
      },
      header: {
        handle: async () => z.object({ authorization: z.string() }),
      },
    };

    await adapter.registerRoute({
      staticServe: null,
      validator: validator as any,
      method: HttpMethod.POST,
      path: '/multi',
      middlewares: [],
      handler,
    });

    expect(adapter['routeQueue']).toHaveLength(1);
    expect(adapter['routeQueue'][0].validator).toBeDefined();
  });

  // Test route without validator
  it('should register route without validator', async () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const handler = mock(() => {});

    await adapter.registerRoute({
      staticServe: null,
      validator: null,
      method: HttpMethod.GET,
      path: '/no-validation',
      middlewares: [],
      handler,
    });

    expect(adapter['routeQueue']).toHaveLength(1);
  });

  // Controller-Based Logging Tests
  describe('Controller-Based Logging', () => {
    it('should group HTTP routes by controller name', async () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter(logger);

      const handler = mock(() => {});

      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/users',
        middlewares: [],
        handler,
        staticServe: null,
        validator: null,
        controllerName: 'UserController',
        controllerBasePath: '/users',
      } as any);

      await adapter.registerRoute({
        method: HttpMethod.POST,
        path: '/users',
        middlewares: [],
        handler,
        staticServe: null,
        validator: null,
        controllerName: 'UserController',
        controllerBasePath: '/users',
      } as any);

      const groups = adapter['groupRoutesByController']();

      expect(groups.size).toBe(1);
      expect(groups.has('UserController')).toBe(true);
      expect(groups.get('UserController')?.routes).toHaveLength(2);
      expect(groups.get('UserController')?.basePath).toBe('/users');
    });

    it('should group WebSocket routes by controller name', () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter(logger);

      const websocketService = {
        namespace: 'chat',
      } as any;

      adapter.registerWebsocketRoute({
        path: 'chat',
        websocketService,
        middlewares: [],
        controllerName: 'ChatController',
      } as any);

      adapter.registerWebsocketRoute({
        path: 'notifications',
        websocketService: { namespace: 'notifications' } as any,
        middlewares: [],
        controllerName: 'NotificationController',
      } as any);

      const groups = adapter['groupWebSocketRoutesByController']();

      expect(groups.size).toBe(2);
      expect(groups.has('ChatController')).toBe(true);
      expect(groups.has('NotificationController')).toBe(true);
      expect(groups.get('ChatController')?.routes).toHaveLength(1);
    });

    it('should sort routes by method in correct order', async () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter(logger);

      const handler = mock(() => {});

      // Register in random order
      await adapter.registerRoute({
        method: HttpMethod.DELETE,
        path: '/users/:id',
        middlewares: [],
        handler,
        staticServe: null,
        validator: null,
        controllerName: 'UserController',
        controllerBasePath: '/users',
      } as any);

      await adapter.registerRoute({
        method: HttpMethod.POST,
        path: '/users',
        middlewares: [],
        handler,
        staticServe: null,
        validator: null,
        controllerName: 'UserController',
        controllerBasePath: '/users',
      } as any);

      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/users',
        middlewares: [],
        handler,
        staticServe: null,
        validator: null,
        controllerName: 'UserController',
        controllerBasePath: '/users',
      } as any);

      const log = adapter['buildControllerBasedLog']();

      // Verify methods are sorted: GET, POST, DELETE
      const lines = log.split('\n');
      const methodLines = lines.filter(
        (line) => line.includes('GET') || line.includes('POST') || line.includes('DELETE'),
      );

      expect(methodLines[0]).toContain('GET');
      expect(methodLines[1]).toContain('POST');
      expect(methodLines[2]).toContain('DELETE');
    });

    it('should merge HTTP and WebSocket routes for same controller', async () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter(logger);

      const handler = mock(() => {});

      // HTTP route
      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/chat/history',
        middlewares: [],
        handler,
        staticServe: null,
        validator: null,
        controllerName: 'ChatController',
        controllerBasePath: '/chat',
      } as any);

      // WebSocket route
      adapter.registerWebsocketRoute({
        path: 'chat',
        websocketService: { namespace: 'chat' } as any,
        middlewares: [],
        controllerName: 'ChatController',
      } as any);

      const log = adapter['buildControllerBasedLog']();

      // Should have both HTTP and WS routes under same controller
      expect(log).toContain('ChatController');
      expect(log).toContain('GET /chat/history');
      expect(log).toContain('WS chat');
    });

    it('should handle controllers sorted alphabetically', async () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter(logger);

      const handler = mock(() => {});

      // Register controllers in reverse alphabetical order
      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/users',
        middlewares: [],
        handler,
        staticServe: null,
        validator: null,
        controllerName: 'ZUserController',
        controllerBasePath: '/users',
      } as any);

      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/admin',
        middlewares: [],
        handler,
        staticServe: null,
        validator: null,
        controllerName: 'AAdminController',
        controllerBasePath: '/admin',
      } as any);

      const log = adapter['buildControllerBasedLog']();
      const lines = log.split('\n').filter((line) => line.includes('Controller'));

      // Should be sorted alphabetically
      expect(lines[0]).toContain('AAdminController');
      expect(lines[1]).toContain('ZUserController');
    });

    it('should handle unknown controller name', async () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter(logger);

      const handler = mock(() => {});

      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/test',
        middlewares: [],
        handler,
        staticServe: null,
        validator: null,
        // No controllerName provided
      } as any);

      const log = adapter['buildControllerBasedLog']();

      // Should group under 'Unknown'
      expect(log).toContain('Unknown');
    });
  });

  // Pattern-Based Global Middlewares Tests
  describe('Pattern-Based Global Middlewares', () => {
    it('should register global middleware with include patterns', () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter(logger);

      const middleware = {
        handle: mock(() => true),
        override: false,
      };

      adapter.use(middleware, {
        include: ['/api/*', '/admin/*'],
      });

      expect(adapter['globalMiddlewares']).toHaveLength(1);
      expect(adapter['globalMiddlewares'][0].config).toEqual({
        include: ['/api/*', '/admin/*'],
      });
    });

    it('should register global middleware with exclude patterns', () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter(logger);

      const middleware = {
        handle: mock(() => true),
        override: false,
      };

      adapter.use(middleware, {
        exclude: ['/health', '/metrics'],
      });

      expect(adapter['globalMiddlewares']).toHaveLength(1);
      expect(adapter['globalMiddlewares'][0].config).toEqual({
        exclude: ['/health', '/metrics'],
      });
    });

    it('should register global middleware with mixed include/exclude patterns', () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter(logger);

      const middleware = {
        handle: mock(() => true),
        override: false,
      };

      adapter.use(middleware, {
        include: ['/api/*'],
        exclude: ['/api/health'],
      });

      expect(adapter['globalMiddlewares']).toHaveLength(1);
      expect(adapter['globalMiddlewares'][0].config).toEqual({
        include: ['/api/*'],
        exclude: ['/api/health'],
      });
    });

    it('should filter global middlewares correctly for specific paths', () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter(logger);

      const authMiddleware = {
        handle: mock(() => true),
        override: false,
      };

      const rateLimitMiddleware = {
        handle: mock(() => true),
        override: false,
      };

      const loggingMiddleware = {
        handle: mock(() => true),
        override: false,
      };

      // Auth: only /api/* and /admin/*, exclude /api/health
      adapter.use(authMiddleware, {
        include: ['/api/*', '/admin/*'],
        exclude: ['/api/health'],
      });

      // RateLimit: exclude /health and /metrics
      adapter.use(rateLimitMiddleware, {
        exclude: ['/health', '/metrics'],
      });

      // Logging: apply to all routes (no config)
      adapter.use(loggingMiddleware);

      // Test filtering for /api/users -> should get auth + rateLimit + logging
      const middlewaresForApiUsers = adapter['getGlobalMiddlewaresForPath']('/api/users');

      expect(middlewaresForApiUsers).toHaveLength(3);
      expect(middlewaresForApiUsers).toContain(authMiddleware);
      expect(middlewaresForApiUsers).toContain(rateLimitMiddleware);
      expect(middlewaresForApiUsers).toContain(loggingMiddleware);

      // Test filtering for /api/health -> should get only rateLimit + logging (auth excluded)
      const middlewaresForApiHealth = adapter['getGlobalMiddlewaresForPath']('/api/health');

      expect(middlewaresForApiHealth).toHaveLength(2);
      expect(middlewaresForApiHealth).not.toContain(authMiddleware);
      expect(middlewaresForApiHealth).toContain(rateLimitMiddleware);
      expect(middlewaresForApiHealth).toContain(loggingMiddleware);

      // Test filtering for /health -> should get only logging (both auth and rateLimit excluded)
      const middlewaresForHealth = adapter['getGlobalMiddlewaresForPath']('/health');

      expect(middlewaresForHealth).toHaveLength(1);
      expect(middlewaresForHealth).not.toContain(authMiddleware);
      expect(middlewaresForHealth).not.toContain(rateLimitMiddleware);
      expect(middlewaresForHealth).toContain(loggingMiddleware);

      // Test filtering for /admin/users -> should get auth + rateLimit + logging
      const middlewaresForAdminUsers = adapter['getGlobalMiddlewaresForPath']('/admin/users');

      expect(middlewaresForAdminUsers).toHaveLength(3);
      expect(middlewaresForAdminUsers).toContain(authMiddleware);
      expect(middlewaresForAdminUsers).toContain(rateLimitMiddleware);
      expect(middlewaresForAdminUsers).toContain(loggingMiddleware);

      // Test filtering for /public/file -> should get only rateLimit + logging (auth not included)
      const middlewaresForPublicFile = adapter['getGlobalMiddlewaresForPath']('/public/file');

      expect(middlewaresForPublicFile).toHaveLength(2);
      expect(middlewaresForPublicFile).not.toContain(authMiddleware);
      expect(middlewaresForPublicFile).toContain(rateLimitMiddleware);
      expect(middlewaresForPublicFile).toContain(loggingMiddleware);
    });

    it('should apply global middlewares to routes during registration', async () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter(logger);

      const authMiddleware = {
        handle: mock(() => true),
        override: false,
      };

      const rateLimitMiddleware = {
        handle: mock(() => true),
        override: false,
      };

      // Register global middlewares
      adapter.use(authMiddleware, {
        include: ['/api/*'],
      });

      adapter.use(rateLimitMiddleware);

      const handler = mock(() => {});

      // Register route
      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/api/users',
        middlewares: [],
        handler,
        staticServe: null,
        validator: null,
      });

      // Check that global middlewares are available for this path
      const applicableMiddlewares = adapter['getGlobalMiddlewaresForPath']('/api/users');

      expect(applicableMiddlewares).toHaveLength(2);
      expect(applicableMiddlewares).toContain(authMiddleware);
      expect(applicableMiddlewares).toContain(rateLimitMiddleware);
    });

    it('should handle wildcard patterns correctly', () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter(logger);

      const middleware = {
        handle: mock(() => true),
        override: false,
      };

      adapter.use(middleware, {
        include: ['/api/*'],
      });

      // Should match paths under /api/
      const middlewaresForApi = adapter['getGlobalMiddlewaresForPath']('/api/users');

      expect(middlewaresForApi).toContain(middleware);

      const middlewaresForApiNested = adapter['getGlobalMiddlewaresForPath']('/api/users/123');

      expect(middlewaresForApiNested).toContain(middleware);

      // Should not match paths not under /api/
      const middlewaresForOther = adapter['getGlobalMiddlewaresForPath']('/other/path');

      expect(middlewaresForOther).not.toContain(middleware);
    });

    it('should handle exact match patterns correctly', () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter(logger);

      const middleware = {
        handle: mock(() => true),
        override: false,
      };

      adapter.use(middleware, {
        exclude: ['/health'],
      });

      // Should not match exact path /health
      const middlewaresForHealth = adapter['getGlobalMiddlewaresForPath']('/health');

      expect(middlewaresForHealth).not.toContain(middleware);

      // Should match other paths
      const middlewaresForHealthCheck = adapter['getGlobalMiddlewaresForPath']('/health-check');

      expect(middlewaresForHealthCheck).toContain(middleware);

      const middlewaresForApi = adapter['getGlobalMiddlewaresForPath']('/api/health');

      expect(middlewaresForApi).toContain(middleware);
    });

    it('should handle multiple global middlewares in correct order', () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter(logger);

      const middleware1 = {
        handle: mock(() => true),
        override: false,
      };

      const middleware2 = {
        handle: mock(() => true),
        override: false,
      };

      const middleware3 = {
        handle: mock(() => true),
        override: false,
      };

      // Register in order: 1, 2, 3
      adapter.use(middleware1);
      adapter.use(middleware2);
      adapter.use(middleware3);

      const middlewares = adapter['getGlobalMiddlewaresForPath']('/any/path');

      // Should maintain registration order
      expect(middlewares).toHaveLength(3);
      expect(middlewares[0]).toBe(middleware1);
      expect(middlewares[1]).toBe(middleware2);
      expect(middlewares[2]).toBe(middleware3);
    });

    it('should apply global middlewares to WebSocket routes', () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter(logger);

      const authMiddleware = {
        handle: mock(() => true),
        override: false,
      };

      adapter.use(authMiddleware, {
        include: ['/chat', '/chat/*'], // Include both exact match and wildcard
      });

      // Check filtering for WebSocket route - exact match
      const middlewaresForChat = adapter['getGlobalMiddlewaresForPath']('/chat');

      expect(middlewaresForChat).toContain(authMiddleware);

      // Check filtering for nested WebSocket route - wildcard match
      const middlewaresForChatRoom = adapter['getGlobalMiddlewaresForPath']('/chat/room123');

      expect(middlewaresForChatRoom).toContain(authMiddleware);
    });
  });

  // Deferred Route Registration Tests
  describe('Deferred Route Registration', () => {
    it('should extract base path correctly', () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter(logger);

      expect(adapter['extractBasePath']('/api/users/:id')).toBe('/api/users');
      expect(adapter['extractBasePath']('/api/users')).toBe('/api/users');
      expect(adapter['extractBasePath']('/users')).toBe('/users');
      expect(adapter['extractBasePath']('/')).toBe('/');
      expect(adapter['extractBasePath']('/api/*/wild')).toBe('/api');
    });

    it('should group routes by base path', async () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter(logger);

      const handler = mock(() => {});

      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/api/users',
        middlewares: [],
        handler,
        staticServe: null,
        validator: null,
      });

      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/api/users/:id',
        middlewares: [],
        handler,
        staticServe: null,
        validator: null,
      });

      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/api/posts',
        middlewares: [],
        handler,
        staticServe: null,
        validator: null,
      });

      const groups = adapter['groupRoutesByBasePath'](adapter['routeQueue']);

      expect(groups.size).toBe(2);
      expect(groups.get('/api/users')?.length).toBe(2);
      expect(groups.get('/api/posts')?.length).toBe(1);
    });

    it('should extract common middlewares', async () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter(logger);

      const authMiddleware = {
        handle: mock(() => true),
        override: false,
      };

      const loggingMiddleware = {
        handle: mock(() => true),
        override: false,
      };

      const handler = mock(() => {});

      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/api/users',
        middlewares: [authMiddleware, loggingMiddleware],
        handler,
        staticServe: null,
        validator: null,
      });

      await adapter.registerRoute({
        method: HttpMethod.POST,
        path: '/api/users',
        middlewares: [authMiddleware, loggingMiddleware],
        handler,
        staticServe: null,
        validator: null,
      });

      const common = adapter['extractCommonMiddlewares'](adapter['routeQueue']);

      expect(common.length).toBe(2);
    });

    it('should not find common middlewares when routes differ', async () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter(logger);

      // Use class instances instead of plain objects for proper constructor comparison
      class AuthMiddleware {

        public handle = mock(() => true);

        public override = false;
      
}

      class LoggingMiddleware {

        public handle = mock(() => true);

        public override = false;
      
}

      const authMiddleware = new AuthMiddleware();
      const loggingMiddleware = new LoggingMiddleware();

      const handler = mock(() => {});

      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/api/users',
        middlewares: [authMiddleware as any],
        handler,
        staticServe: null,
        validator: null,
      });

      await adapter.registerRoute({
        method: HttpMethod.POST,
        path: '/api/users',
        middlewares: [loggingMiddleware as any],
        handler,
        staticServe: null,
        validator: null,
      });

      const common = adapter['extractCommonMiddlewares'](adapter['routeQueue']);

      expect(common.length).toBe(0);
    });

    it('should return empty array for single route', async () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter(logger);

      const handler = mock(() => {});

      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/single',
        middlewares: [],
        handler,
        staticServe: null,
        validator: null,
      });

      const common = adapter['extractCommonMiddlewares'](adapter['routeQueue']);

      expect(common.length).toBe(0);
    });

    it('should register routes on start', async () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter(logger);

      const routeSpy = spyOn(adapter.app, 'route');
      const handler = mock(() => {});

      // Queue multiple routes with same base path and common middleware
      const authMiddleware = {
        handle: mock(() => true),
        override: false,
      };

      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/api/users',
        middlewares: [authMiddleware],
        handler,
        staticServe: null,
        validator: null,
      });

      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/api/users/:id',
        middlewares: [authMiddleware],
        handler,
        staticServe: null,
        validator: null,
      });

      adapter.setPort(9999);

      // Start should trigger route registration with grouping
      const server = await adapter.start();

      // Route grouping should have been used (routes mounted at base path)
      expect(routeSpy).toHaveBeenCalled();

      server.stop();
    });

    it('should handle routes with no common middleware', async () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter(logger);

      const getSpy = spyOn(adapter.app, 'get');
      const handler = mock(() => {});

      const middleware1 = {
        handle: mock(() => true),
        override: false,
      };

      const middleware2 = {
        handle: mock(() => true),
        override: false,
      };

      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/route1',
        middlewares: [middleware1],
        handler,
        staticServe: null,
        validator: null,
      });

      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/route2',
        middlewares: [middleware2],
        handler,
        staticServe: null,
        validator: null,
      });

      adapter.setPort(9998);

      const server = await adapter.start();

      // Routes registered individually (no common middleware)
      expect(getSpy).toHaveBeenCalled();

      server.stop();
    });

    it('should register routes only once on multiple start calls', async () => {
      const logger = createMockLogger();
      const adapter = new HonoAdapter(logger);

      const handler = mock(() => {});

      await adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/test',
        middlewares: [],
        handler,
        staticServe: null,
        validator: null,
      });

      adapter.setPort(9997);

      const server1 = await adapter.start();

      server1.stop();

      const queueLengthBefore = adapter['routeQueue'].length;

      const server2 = await adapter.start();

      // Routes should not be registered again
      expect(adapter['routesRegistered']).toBe(true);
      expect(adapter['routeQueue'].length).toBe(queueLengthBefore);

      server2.stop();
    });
  });
});
