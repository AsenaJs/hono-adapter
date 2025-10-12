import {
  type Context,
  type Handler,
  Hono,
  type MiddlewareHandler,
  type ValidationTargets
} from 'hono';
import type { Server } from 'bun';
import * as bun from 'bun';
import { HonoContextWrapper } from './HonoContextWrapper';
import type {
  AsenaWebsocketAdapter,
  BaseStaticServeParams,
  WebsocketRouteParams
} from '@asenajs/asena/adapter';
import {
  AsenaAdapter,
  type AsenaServeOptions,
  type BaseMiddleware,
  type BaseValidator,
  type RouteParams,
  VALIDATOR_METHODS,
  type ValidatorHandler,
} from '@asenajs/asena/adapter';
import type { GlobalMiddlewareConfig } from '@asenajs/asena/server/config';
import { shouldApplyMiddleware } from '@asenajs/asena/utils/patternMatcher';
import type { HonoErrorHandler, HonoHandler, StaticServeExtras } from './types';
import { blue, green, red, type ServerLogger, yellow } from '@asenajs/asena/logger';
import { type Hook, zValidator } from '@hono/zod-validator';
import type { ValidationSchema, ValidationSchemaWithHook } from './defaults';
import type { ZodError, ZodType, ZodTypeDef } from 'zod';
import { middlewareParser } from './utils/middlewareParser';
import type { Context as HonoAdapterContext } from './defaults/Context';
import { HttpMethod } from '@asenajs/asena/web-types';
import { HonoWebsocketAdapter } from './HonoWebsocketAdapter';
import type { WebSocketData } from '@asenajs/asena/web-socket';
import { serveStatic } from 'hono/bun';

export class HonoAdapter extends AsenaAdapter<HonoAdapterContext, ValidationSchema> {

  public name = 'HonoAdapter';

  public app = new Hono();

  private server: Server;

  // @ts-ignore
  private options: AsenaServeOptions = {} satisfies AsenaServeOptions;

  // Deferred route registration
  private routeQueue: RouteParams<HonoAdapterContext, ValidationSchema, StaticServeExtras>[] = [];

  /**
   * WebSocket route queue for deferred registration
   * WebSocket routes are queued during initialization and registered when server starts
   */
  private wsRouteQueue: WebsocketRouteParams<HonoAdapterContext>[] = [];

  /**
   * Global middlewares with optional path filtering configuration
   * Middlewares are stored with their pattern config and applied during route registration
   */
  private globalMiddlewares: Array<{
    middleware: BaseMiddleware<HonoAdapterContext>;
    config?: GlobalMiddlewareConfig['routes'];
  }> = [];

  private routesRegistered = false;

  private readonly methodMap = {
    [HttpMethod.GET]: (path: string, ...handlers: (MiddlewareHandler | Handler)[]) => this.app.get(path, ...handlers),
    [HttpMethod.POST]: (path: string, ...handlers: any[]) => this.app.post(path, ...handlers),
    [HttpMethod.PUT]: (path: string, ...handlers: any[]) => this.app.put(path, ...handlers),
    [HttpMethod.DELETE]: (path: string, ...handlers: any[]) => this.app.delete(path, ...handlers),
    [HttpMethod.PATCH]: (path: string, ...handlers: any[]) => this.app.patch(path, ...handlers),
    [HttpMethod.OPTIONS]: (path: string, ...handlers: any[]) => this.app.options(path, ...handlers),
    [HttpMethod.CONNECT]: (path: string, ...handlers: any[]) =>
      this.app.on(HttpMethod.CONNECT.toUpperCase(), path, ...handlers),
    [HttpMethod.HEAD]: (path: string, ...handlers: any[]) =>
      this.app.on(HttpMethod.HEAD.toUpperCase(), path, ...handlers),
    [HttpMethod.TRACE]: (path: string, ...handlers: any[]) =>
      this.app.on(HttpMethod.TRACE.toUpperCase(), path, ...handlers),
  };

  public constructor(logger: ServerLogger, websocketAdapter?: AsenaWebsocketAdapter) {
    super(logger, websocketAdapter);
    if (!this.websocketAdapter) {
      this.websocketAdapter = new HonoWebsocketAdapter(logger);
    }

    // to ensure that the logger is set
    if (!this.websocketAdapter.logger && logger) {
      this.websocketAdapter.logger = this.logger;
    }
  }

  /**
   * Registers a global middleware with optional path filtering
   *
   * Middlewares are stored and applied during route registration based on include/exclude patterns.
   * This enables zero-runtime-overhead pattern matching.
   *
   * @param middleware - The middleware to register globally
   * @param config - Optional path filtering configuration with include/exclude patterns
   *
   * @example
   * ```typescript
   * // Apply to all routes
   * adapter.use(authMiddleware);
   *
   * // Apply only to specific patterns
   * adapter.use(authMiddleware, {
   *   include: ['/api/*', '/admin/*'],
   *   exclude: ['/api/health']
   * });
   *
   * // Apply to all except specific patterns
   * adapter.use(rateLimitMiddleware, {
   *   exclude: ['/health', '/metrics']
   * });
   * ```
   */
  public use(middleware: BaseMiddleware<HonoAdapterContext>, config?: GlobalMiddlewareConfig['routes']) {
    // Store middleware with config for deferred application during route registration
    this.globalMiddlewares.push({ middleware, config });
  }

  public async registerRoute(params: RouteParams<HonoAdapterContext, ValidationSchema, StaticServeExtras>) {
    // Queue the route for deferred registration
    this.routeQueue.push(params);
  }

  /**
   * Registers a WebSocket route (deferred registration)
   *
   * Routes are queued and will be registered when the server starts.
   * This allows for controller-based logging and optimization.
   *
   * @param params - WebSocket route parameters
   */
  public registerWebsocketRoute(params: WebsocketRouteParams<HonoAdapterContext>): Promise<void> | void {
    // Queue WebSocket route for building during start()
    this.wsRouteQueue.push(params);

    // Also register WebSocket service with adapter for namespace tracking
    if (this.websocketAdapter && params.websocketService) {
      this.websocketAdapter.registerWebSocket(params.websocketService);
    }
  }

  public async start() {
    // Register all queued routes with optimization
    if (!this.routesRegistered) {
      await this.optimizeAndRegisterRoutes();
      this.routesRegistered = true;
    }

    this.websocketAdapter.prepareWebSocket(this.options?.wsOptions);

    this.server = bun.serve({
      ...this.options.serveOptions,
      port: this.port,
      fetch: this.app.fetch,
      websocket: this.websocketAdapter.websocket,
    });

    this.websocketAdapter.startWebsocket(this.server);

    // Log controller-based route information
    if (this.routeQueue.length > 0 || this.wsRouteQueue.length > 0) {
      this.logger.info(this.buildControllerBasedLog());
    }

    this.logger.info(`Server running at http://localhost:${this.server.port}`);

    return this.server;
  }

  /**
   * Registers global error handler with enhanced error handling capabilities
   * @param errorHandler - Custom error handler function
   */
  public onError(errorHandler: HonoErrorHandler) {
    this.app.onError((error, context) => {
      // Log error with full details
      this.logger.error('Application error occurred:', {
        message: error.message,
        stack: error.stack,
        path: context.req.path,
        method: context.req.method,
        timestamp: new Date().toISOString(),
      });

      // Wrap context
      const wrapper = new HonoContextWrapper(context);

      try {
        // Call user-defined error handler
        return errorHandler(error, wrapper);
      } catch (handlerError) {
        // Fallback if error handler itself throws
        this.logger.error('Error handler threw an error:', handlerError);

        return context.json(
          {
            error: 'Internal server error',
            message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : error.message,
            timestamp: new Date().toISOString(),
          },
          500,
        );
      }
    });
  }

  public async serveOptions(options: () => Promise<AsenaServeOptions> | AsenaServeOptions) {
    this.options = await options();
  }

  public setPort(port: number) {
    this.port = port;
  }

  private prepareMiddlewares(middlewares: BaseMiddleware<HonoAdapterContext>[]): MiddlewareHandler[] {
    return middlewareParser(middlewares);
  }

  private prepareHandler(handler: HonoHandler): Handler {
    return (c: Context) => handler(new HonoContextWrapper(c));
  }

  /**
   * Prepares static serve options with enhanced features
   * @param staticServe - Base static serve parameters
   * @returns Configured static serve options for Hono
   */
  private prepareStaticServeOptions(staticServe: BaseStaticServeParams) {
    let staticServeOptions: {
      root?: string;
      path?: string;
      precompressed?: boolean;
      mimes?: Record<string, string>;
      rewriteRequestPath?: (path: string) => string;
      onFound?: (path: string, c: Context) => void | Promise<void>;
      onNotFound?: (path: string, c: Context) => void | Promise<void>;
    } = {
      root: staticServe.root,
    };

    if (staticServe.rewriteRequestPath) {
      staticServeOptions.rewriteRequestPath = staticServe.rewriteRequestPath;
    }

    if (staticServe.onFound) {
      if (staticServe.onFound.override) {
        // @ts-ignore
        staticServeOptions.onFound = staticServe.onFound.handler;
      } else {
        staticServeOptions.onFound = async (path, c: Context) => {
          // Add cache headers and custom headers
          if (staticServe.extra?.cacheControl) {
            c.header('Cache-Control', staticServe.extra.cacheControl);
          } else {
            // Default cache control for static files
            c.header('Cache-Control', 'public, max-age=31536000');
          }

          // Add custom headers if provided
          if (staticServe.extra?.headers) {
            Object.entries(staticServe.extra.headers).forEach(([key, value]) => {
              c.header(key, value as string);
            });
          }

          // Call user callback
          await staticServe.onFound.handler(path, new HonoContextWrapper(c));
        };
      }
    } else if (staticServe.extra?.cacheControl || staticServe.extra?.headers) {
      // Add default onFound handler if cache or custom headers are specified
      staticServeOptions.onFound = (_path, c: Context) => {
        if (staticServe.extra?.cacheControl) {
          c.header('Cache-Control', staticServe.extra.cacheControl);
        } else {
          c.header('Cache-Control', 'public, max-age=31536000');
        }

        if (staticServe.extra?.headers) {
          Object.entries(staticServe.extra.headers).forEach(([key, value]) => {
            c.header(key, value as string);
          });
        }
      };
    }

    if (staticServe.onNotFound) {
      if (staticServe.onNotFound.override) {
        // @ts-ignore
        staticServeOptions.onNotFound = staticServe.onNotFound.handler;
      } else {
        staticServeOptions.onNotFound = (path, c: Context) => {
          staticServe.onNotFound.handler(path, new HonoContextWrapper(c));
        };
      }
    }

    if (staticServe.extra) {
      staticServeOptions.mimes = staticServe.extra.mimes;
      staticServeOptions.precompressed = staticServe.extra.precompressed;
    }

    return staticServeOptions;
  }

  /**
   * Prepares validation middleware with enhanced error handling
   * @param baseValidator - The validator to prepare
   * @returns Array of Hono middleware handlers for validation
   */
  private async prepareValidator(
    baseValidator: BaseValidator<ValidationSchema | ValidationSchemaWithHook>,
  ): Promise<MiddlewareHandler[]> {
    if (!baseValidator) {
      return [];
    }

    const validators: MiddlewareHandler[] = [];

    for (const key of VALIDATOR_METHODS) {
      const validatorHandler = baseValidator[key] as ValidatorHandler<ValidationSchema | ValidationSchemaWithHook>;

      // Skip if not a valid validator
      if (!validatorHandler || typeof validatorHandler.handle !== 'function') {
        continue;
      }

      try {
        const validationSchema = await validatorHandler.handle();

        // Validate that we got a valid schema
        if (!validationSchema) {
          this.logger.warn(`Validator for '${key}' returned null/undefined, skipping`);

          continue;
        }

        let schema: ZodType<any, ZodTypeDef, any>;
        let hook: Hook<any, any, any> | undefined;

        if (typeof validationSchema === 'object' && 'schema' in validationSchema) {
          schema = validationSchema.schema;
          hook = validationSchema.hook;

          // Validate schema is actually a Zod schema
          if (!schema || typeof schema.parse !== 'function') {
            throw new Error(`Invalid Zod schema provided for '${key}' validator`);
          }
        } else {
          schema = validationSchema as ZodType<any, ZodTypeDef, any>;

          if (!schema || typeof schema.parse !== 'function') {
            throw new Error(`Invalid Zod schema provided for '${key}' validator`);
          }
        }

        // Create validator with proper error handling
        const validator = zValidator(
          key as keyof ValidationTargets,
          schema,
          hook ||
            ((result, c) => {
              // Default hook with better error formatting
              if (!result.success) {
                return c.json(
                  {
                    error: 'Validation failed',
                    details: (
                      result as {
                        success: false;
                        error: ZodError;
                        data: any;
                      }
                    ).error.flatten(),
                    target: key,
                  },
                  400,
                );
              }
            }),
        );

        validators.push(validator);
      } catch (error) {
        this.logger.error(`Failed to prepare validator for '${key}':`, error);

        throw new Error(
          `Validator preparation failed for '${key}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return validators;
  }

  /**
   * Gets global middlewares that should be applied to a specific path
   *
   * Filters global middlewares based on their include/exclude patterns.
   * Pattern matching happens once during route registration (zero runtime overhead).
   *
   * @param path - The route path to check against middleware patterns
   * @returns Array of middlewares that should be applied to this path
   *
   * @example
   * ```typescript
   * // If global middlewares are:
   * // - authMiddleware with { include: ['/api/*'], exclude: ['/api/health'] }
   * // - rateLimitMiddleware with no config
   *
   * getGlobalMiddlewaresForPath('/api/users')    // => [authMiddleware, rateLimitMiddleware]
   * getGlobalMiddlewaresForPath('/api/health')   // => [rateLimitMiddleware]
   * getGlobalMiddlewaresForPath('/public/file')  // => [rateLimitMiddleware]
   * ```
   */
  private getGlobalMiddlewaresForPath(path: string): BaseMiddleware<HonoAdapterContext>[] {
    return this.globalMiddlewares
      .filter(({ config }) => shouldApplyMiddleware(path, config))
      .map(({ middleware }) => middleware);
  }

  /**
   * Extracts base path from a route path
   * Examples:
   * - "/api/users/:id" -> "/api/users"
   * - "/users" -> "/users"
   * - "/" -> "/"
   */
  private extractBasePath(path: string): string {
    // Remove trailing slash
    let normalized = path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path;

    // Find the last segment without parameters
    const segments = normalized.split('/');
    const baseSegments = [];

    for (const segment of segments) {
      if (segment.startsWith(':') || segment.includes('*')) {
        break;
      }

      baseSegments.push(segment);
    }

    return baseSegments.join('/') || '/';
  }

  /**
   * Groups routes by their base path
   * Returns a map of base path -> routes with that base path
   */
  private groupRoutesByBasePath(
    routes: RouteParams<HonoAdapterContext, ValidationSchema, StaticServeExtras>[],
  ): Map<string, RouteParams<HonoAdapterContext, ValidationSchema, StaticServeExtras>[]> {
    const groups = new Map<string, RouteParams<HonoAdapterContext, ValidationSchema, StaticServeExtras>[]>();

    for (const route of routes) {
      const basePath = this.extractBasePath(route.path);

      if (!groups.has(basePath)) {
        groups.set(basePath, []);
      }

      groups.get(basePath)!.push(route);
    }

    return groups;
  }

  /**
   * Finds common middlewares across all routes in a group
   * Returns middlewares that appear in ALL routes
   */
  private extractCommonMiddlewares(
    routes: RouteParams<HonoAdapterContext, ValidationSchema, StaticServeExtras>[],
  ): BaseMiddleware<HonoAdapterContext>[] {
    if (routes.length === 0) return [];

    if (routes.length === 1) return [];

    // Get middleware from first route
    const firstRouteMiddlewares = routes[0].middlewares || [];

    // Find middlewares that exist in all routes

    return firstRouteMiddlewares.filter((middleware) => {
      return routes.every((route) => {
        return (route.middlewares || []).some((mw) => {
          // Compare by constructor name (class identity)
          return mw.constructor.name === middleware.constructor.name;
        });
      });
    });
  }

  /**
   * Registers routes to Hono app with optimization
   * Groups routes by base path and applies common middlewares at group level
   * Also registers WebSocket routes
   */
  private async optimizeAndRegisterRoutes(): Promise<void> {
    // Register HTTP routes
    if (this.routeQueue.length > 0) {
      // Group routes by base path
      const routeGroups = this.groupRoutesByBasePath(this.routeQueue);

      for (const [basePath, routes] of routeGroups) {
        // Find common middlewares for this group
        const commonMiddlewares = this.extractCommonMiddlewares(routes);

        if (routes.length > 1 && commonMiddlewares.length > 0) {
          // Multiple routes with common middlewares - use grouping
          await this.registerRouteGroup(basePath, commonMiddlewares, routes);
        } else {
          // Single route or no common middlewares - register individually
          for (const route of routes) {
            await this.registerRouteDirect(route);
          }
        }
      }
    }

    // Register WebSocket routes
    if (this.wsRouteQueue.length > 0) {
      for (const wsRoute of this.wsRouteQueue) {
        await this.registerWebsocketRouteDirect(wsRoute);
      }
    }

    // Log controller summary
    this.logControllerSummary();
  }

  /**
   * Logs a summary of registered controllers
   */
  private logControllerSummary(): void {
    const httpGroups = this.groupRoutesByController();
    const wsGroups = this.groupWebSocketRoutesByController();

    // Log HTTP controllers
    for (const [controllerName, group] of httpGroups) {
      const routeCount = group.routes.length;
      const routeText = routeCount === 1 ? 'route' : 'routes';

      this.logger.info(
        `${green('✓')} Successfully registered ${yellow('CONTROLLER')} ${blue(controllerName)} ${yellow(`(${routeCount} ${routeText})`)}`
      );
    }

    // Log WebSocket controllers (only those that don't have HTTP routes)
    for (const [controllerName, group] of wsGroups) {
      if (!httpGroups.has(controllerName)) {
        const routeCount = group.routes.length;
        const routeText = routeCount === 1 ? 'route' : 'routes';

        this.logger.info(
          `${green('✓')} Successfully registered ${yellow('WEBSOCKET')} ${blue(controllerName)} ${yellow(`(${routeCount} ${routeText})`)}`
        );
      }
    }
  }

  /**
   * Registers a WebSocket route directly
   * Converts HTTP GET route to WebSocket upgrade endpoint
   */
  private async registerWebsocketRouteDirect(wsRoute: WebsocketRouteParams<HonoAdapterContext>): Promise<void> {
    // Get filtered global middlewares for this WebSocket route
    const applicableGlobalMiddlewares = this.getGlobalMiddlewaresForPath(wsRoute.path);
    const preparedGlobalMiddlewares = this.prepareMiddlewares(applicableGlobalMiddlewares);

    const preparedMiddlewares = this.prepareMiddlewares(wsRoute.middlewares || []);

    // Combine: global middlewares -> route middlewares
    const allMiddlewares = [...preparedGlobalMiddlewares, ...preparedMiddlewares];

    this.app.get(`/${wsRoute.path}`, ...allMiddlewares, async (c: Context, next) => {
      const websocketData = c.get('_websocketData') || {};

      const id = bun.randomUUIDv7();

      const data: WebSocketData = { values: websocketData, id, path: wsRoute.path };
      const upgradeResult = this.server.upgrade(c.req.raw, { data });

      if (upgradeResult) {
        return new Response(null);
      }

      await next(); // Failed
    });
  }

  /**
   * Registers a group of routes with common middlewares at base path level
   */
  private async registerRouteGroup(
    basePath: string,
    commonMiddlewares: BaseMiddleware<HonoAdapterContext>[],
    routes: RouteParams<HonoAdapterContext, ValidationSchema, StaticServeExtras>[],
  ): Promise<void> {
    // Create grouped Hono instance
    const group = new Hono();

    // Get filtered global middlewares for this base path
    const applicableGlobalMiddlewares = this.getGlobalMiddlewaresForPath(basePath);
    const preparedGlobalMiddlewares = this.prepareMiddlewares(applicableGlobalMiddlewares);

    // Apply global middlewares first (before common middlewares)
    if (preparedGlobalMiddlewares.length > 0) {
      group.use('*', ...preparedGlobalMiddlewares);
    }

    // Apply common middlewares to the entire group
    const preparedCommonMiddlewares = this.prepareMiddlewares(commonMiddlewares);

    if (preparedCommonMiddlewares.length > 0) {
      group.use('*', ...preparedCommonMiddlewares);
    }

    // Method map for group
    const groupMethodMap = {
      [HttpMethod.GET]: (path: string, ...handlers: (MiddlewareHandler | Handler)[]) => group.get(path, ...handlers),
      [HttpMethod.POST]: (path: string, ...handlers: any[]) => group.post(path, ...handlers),
      [HttpMethod.PUT]: (path: string, ...handlers: any[]) => group.put(path, ...handlers),
      [HttpMethod.DELETE]: (path: string, ...handlers: any[]) => group.delete(path, ...handlers),
      [HttpMethod.PATCH]: (path: string, ...handlers: any[]) => group.patch(path, ...handlers),
      [HttpMethod.OPTIONS]: (path: string, ...handlers: any[]) => group.options(path, ...handlers),
      [HttpMethod.CONNECT]: (path: string, ...handlers: any[]) =>
        group.on(HttpMethod.CONNECT.toUpperCase(), path, ...handlers),
      [HttpMethod.HEAD]: (path: string, ...handlers: any[]) =>
        group.on(HttpMethod.HEAD.toUpperCase(), path, ...handlers),
      [HttpMethod.TRACE]: (path: string, ...handlers: any[]) =>
        group.on(HttpMethod.TRACE.toUpperCase(), path, ...handlers),
    };

    // Register each route in the group
    for (const route of routes) {
      // Remove common middlewares from route middlewares
      const uniqueMiddlewares = (route.middlewares || []).filter(
        (mw) => !commonMiddlewares.some((common) => common.constructor.name === mw.constructor.name),
      );

      const preparedMiddlewares = this.prepareMiddlewares(uniqueMiddlewares);
      const validators = route.validator ? await this.prepareValidator(route.validator) : [];
      const allMiddlewares = [...validators, ...preparedMiddlewares];

      const methodHandler = groupMethodMap[route.method];

      if (!methodHandler) {
        throw new Error(`Invalid HTTP method: ${route.method}`);
      }

      // Calculate relative path
      let relativePath = route.path;

      if (route.path.startsWith(basePath) && basePath !== '/') {
        relativePath = route.path.slice(basePath.length);
      }

      if (!relativePath.startsWith('/')) {
        relativePath = '/' + relativePath;
      }

      // Register to group
      if (route.staticServe) {
        methodHandler(relativePath, ...allMiddlewares, serveStatic(this.prepareStaticServeOptions(route.staticServe)));
      } else {
        const handler = this.prepareHandler(route.handler);

        methodHandler(relativePath, ...allMiddlewares, handler);
      }
    }

    // Mount group to main app
    this.app.route(basePath, group);
  }

  /**
   * Registers a single route directly without grouping
   */
  private async registerRouteDirect(
    route: RouteParams<HonoAdapterContext, ValidationSchema, StaticServeExtras>,
  ): Promise<void> {
    // Get filtered global middlewares for this route
    const applicableGlobalMiddlewares = this.getGlobalMiddlewaresForPath(route.path);
    const preparedGlobalMiddlewares = this.prepareMiddlewares(applicableGlobalMiddlewares);

    const preparedMiddlewares = this.prepareMiddlewares(route.middlewares || []);
    const validators = route.validator ? await this.prepareValidator(route.validator) : [];

    // Combine: validators -> global middlewares -> route middlewares
    const allMiddlewares = [...validators, ...preparedGlobalMiddlewares, ...preparedMiddlewares];

    const methodHandler = this.methodMap[route.method];

    if (!methodHandler) {
      throw new Error(`Invalid HTTP method: ${route.method}`);
    }

    if (route.staticServe) {
      methodHandler(route.path, ...allMiddlewares, serveStatic(this.prepareStaticServeOptions(route.staticServe)));
    } else {
      const handler = this.prepareHandler(route.handler);

      methodHandler(route.path, ...allMiddlewares, handler);
    }
  }

  /**
   * Groups HTTP routes by controller name
   *
   * Creates a map of controller names to their routes for organized logging.
   * Each group contains the controller's base path and all its routes.
   *
   * @returns Map of controller names to route groups
   *
   * @example
   * ```typescript
   * groupRoutesByController()
   * // => Map {
   * //   'UserController' => {
   * //     basePath: '/users',
   * //     routes: [{ method: 'GET', path: '/users' }, { method: 'POST', path: '/users' }]
   * //   }
   * // }
   * ```
   */
  private groupRoutesByController(): Map<
    string,
    { basePath: string; routes: Array<{ method: string; path: string }> }
  > {
    const groups = new Map<string, { basePath: string; routes: Array<{ method: string; path: string }> }>();

    for (const route of this.routeQueue) {
      const controllerName = route.controllerName || 'Unknown';
      const controllerBasePath = route.controllerBasePath || '/';

      if (!groups.has(controllerName)) {
        groups.set(controllerName, {
          basePath: controllerBasePath,
          routes: [],
        });
      }

      groups.get(controllerName)!.routes.push({
        method: route.method.toUpperCase(),
        path: route.path,
      });
    }

    return groups;
  }

  /**
   * Groups WebSocket routes by controller name
   *
   * Creates a map of controller names to their WebSocket routes for organized logging.
   *
   * @returns Map of controller names to WebSocket route groups
   *
   * @example
   * ```typescript
   * groupWebSocketRoutesByController()
   * // => Map {
   * //   'ChatController' => {
   * //     basePath: '/chat',
   * //     routes: [{ path: '/chat' }]
   * //   }
   * // }
   * ```
   */
  private groupWebSocketRoutesByController(): Map<string, { basePath: string; routes: Array<{ path: string }> }> {
    const groups = new Map<string, { basePath: string; routes: Array<{ path: string }> }>();

    for (const wsRoute of this.wsRouteQueue) {
      const controllerName = wsRoute.controllerName || 'Unknown';
      const controllerBasePath = wsRoute.path; // WebSocket uses path as base path

      if (!groups.has(controllerName)) {
        groups.set(controllerName, {
          basePath: controllerBasePath,
          routes: [],
        });
      }

      groups.get(controllerName)!.routes.push({
        path: wsRoute.path,
      });
    }

    return groups;
  }

  /**
   * Builds controller-based log output
   *
   * Creates a formatted string showing all routes grouped by controller,
   * with HTTP and WebSocket routes clearly organized.
   *
   * @returns Formatted log string
   *
   * @example
   * Output format:
   * ```
   * Registered routes:
   *
   *   UserController (/users):
   *     GET /users
   *     GET /users/:id
   *     POST /users
   *
   *   ChatController (/chat):
   *     WS /chat
   * ```
   */
  private buildControllerBasedLog(): string {
    const httpGroups = this.groupRoutesByController();
    const wsGroups = this.groupWebSocketRoutesByController();

    // Merge WebSocket groups into HTTP groups
    for (const [controllerName, wsGroup] of wsGroups) {
      if (httpGroups.has(controllerName)) {
        // Add WebSocket routes to existing controller group
        const httpGroup = httpGroups.get(controllerName)!;

        for (const wsRoute of wsGroup.routes) {
          httpGroup.routes.push({
            method: 'WS',
            path: wsRoute.path,
          });
        }
      } else {
        // Create new group for WebSocket-only controller
        httpGroups.set(controllerName, {
          basePath: wsGroup.basePath,
          routes: wsGroup.routes.map((r) => ({
            method: 'WS',
            path: r.path,
          })),
        });
      }
    }

    // Build log output with colors
    const lines: string[] = [];

    // Sort controllers alphabetically for consistent output
    const sortedControllers = Array.from(httpGroups.entries()).sort(([a], [b]) => a.localeCompare(b));

    for (const [controllerName, group] of sortedControllers) {
      lines.push(`  ${blue(controllerName)} ${yellow(`(${group.basePath})`)}`);

      // Sort routes: GET first, then POST, PUT, PATCH, DELETE, WS
      const methodOrder = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'WS'];
      const sortedRoutes = group.routes.sort((a, b) => {
        const orderA = methodOrder.indexOf(a.method);
        const orderB = methodOrder.indexOf(b.method);

        return orderA - orderB;
      });

      for (const route of sortedRoutes) {
        // Colorize method based on type
        let coloredMethod = route.method;

        if (route.method === 'GET') {
          coloredMethod = green(route.method);
        } else if (route.method === 'POST') {
          coloredMethod = blue(route.method);
        } else if (route.method === 'PUT') {
          coloredMethod = yellow(route.method);
        } else if (route.method === 'DELETE') {
          coloredMethod = red(route.method);
        } else if (route.method === 'WS') {
          coloredMethod = blue(route.method);
        }

        lines.push(`    ${coloredMethod} ${route.path}`);
      }

      lines.push(''); // Empty line between controllers
    }

    return lines.join('\n');
  }

}
