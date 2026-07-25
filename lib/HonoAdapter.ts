import { type Context, type Handler, Hono, type MiddlewareHandler, type ValidationTargets } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Server } from 'bun';
import * as bun from 'bun';
import { HonoContextWrapper } from './HonoContextWrapper';
import type { BaseStaticServeParams, WebsocketRouteParams } from '@asenajs/asena/adapter';
import {
  AsenaAdapter,
  type AsenaServeOptions,
  type AsenaStartOptions,
  type BaseMiddleware,
  type BaseValidator,
  type RouteParams,
  VALIDATOR_METHODS,
  type ValidatorHandler,
} from '@asenajs/asena/adapter';
import type { GlobalMiddlewareConfig, GlobalMiddlewareRouteConfig } from '@asenajs/asena/server/config';
import { shouldApplyMiddleware } from '@asenajs/asena/utils';
import type { HonoAdapterOptions, HonoErrorHandler, HonoHandler, StaticServeExtras } from './types';
import { blue, green, red, type ServerLogger, yellow } from '@asenajs/asena/logger';
import { type Hook, zValidator } from '@hono/zod-validator';
import type { ValidationSchema, ValidationSchemaWithHook } from './defaults';
import type { ZodError, ZodType } from 'zod';
import { middlewareParser } from './utils/middlewareParser';
import { compareRoutePriority } from './utils/routePriority';
import type { Context as HonoAdapterContext } from './defaults/Context';
import { HttpMethod } from '@asenajs/asena/web-types';
import { HonoWebsocketAdapter } from './HonoWebsocketAdapter';
import type { WebSocketData } from '@asenajs/asena/web-socket';
import { serveStatic } from 'hono/bun';

export class HonoAdapter extends AsenaAdapter<HonoAdapterContext, ValidationSchema> {
  public name = 'HonoAdapter';

  public app: Hono;

  private readonly _strict: boolean = true;

  private server: Server<WebSocketData>;

  private options: AsenaServeOptions = {} satisfies AsenaServeOptions;

  /**
   * Normalizes a route path for Hono compatibility.
   * Strips trailing slash (except root '/') because Hono's strict:false
   * normalizes incoming request paths by removing trailing slashes.
   * Registered routes must match this normalized form.
   */
  private normalizePath(path: string): string {
    if (path.length > 1 && path.endsWith('/')) {
      return path.slice(0, -1);
    }

    return path;
  }

  public async stop(closeActiveConnections = true): Promise<void> {
    if (this.server) {
      await this.server.stop(closeActiveConnections);
    }
  }

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
  private globalMiddlewares: {
    middleware: BaseMiddleware<HonoAdapterContext>;
    config?: GlobalMiddlewareConfig['routes'];
  }[] = [];

  /**
   * HTML routes for FrontendController pages
   * Stored separately and merged into Bun.serve() routes at start time
   */
  private htmlRoutes = new Map<string, unknown>();

  /**
   * Queue of FrontendController route metadata for deferred logging at start time
   */
  private frontEndRouteQueue: { path: string; controllerName: string; controllerBasePath: string }[] = [];

  private routesRegistered = false;

  private readonly methodMap = {
    [HttpMethod.GET]: (path: string, ...handlers: any[]) => (this.app as any).get(path, ...handlers),
    [HttpMethod.POST]: (path: string, ...handlers: any[]) => (this.app as any).post(path, ...handlers),
    [HttpMethod.PUT]: (path: string, ...handlers: any[]) => (this.app as any).put(path, ...handlers),
    [HttpMethod.DELETE]: (path: string, ...handlers: any[]) => (this.app as any).delete(path, ...handlers),
    [HttpMethod.PATCH]: (path: string, ...handlers: any[]) => (this.app as any).patch(path, ...handlers),
    [HttpMethod.OPTIONS]: (path: string, ...handlers: any[]) => (this.app as any).options(path, ...handlers),
    [HttpMethod.CONNECT]: (path: string, ...handlers: any[]) =>
      (this.app as any).on([HttpMethod.CONNECT.toUpperCase()], path, ...handlers),
    // HEAD is handled automatically by Hono via GET routes (HTTP spec: HEAD = GET without body).
    // Registering via app.on(['HEAD'], ...) does not work in Hono — it silently 404s.
    [HttpMethod.HEAD]: (path: string, ...handlers: any[]) => (this.app as any).get(path, ...handlers),
    [HttpMethod.TRACE]: (path: string, ...handlers: any[]) =>
      (this.app as any).on([HttpMethod.TRACE.toUpperCase()], path, ...handlers),
    [HttpMethod.ALL]: (path: string, ...handlers: any[]) => (this.app as any).all(path, ...handlers),
  };

  public constructor(options: HonoAdapterOptions);
  public constructor(logger: ServerLogger, websocketAdapter?: HonoWebsocketAdapter, app?: Hono<any, any, any>);
  public constructor(
    loggerOrOptions: ServerLogger | HonoAdapterOptions,
    websocketAdapter?: HonoWebsocketAdapter,
    app?: Hono<any, any, any>,
  ) {
    let logger: ServerLogger;
    let wsAdapter: HonoWebsocketAdapter;
    let honoApp: Hono<any, any, any> | undefined;

    if (typeof loggerOrOptions === 'object' && 'logger' in loggerOrOptions) {
      logger = loggerOrOptions.logger;
      wsAdapter = loggerOrOptions.websocketAdapter ?? new HonoWebsocketAdapter(logger);
      honoApp = loggerOrOptions.app;
    } else {
      logger = loggerOrOptions;
      wsAdapter = websocketAdapter ?? new HonoWebsocketAdapter(logger);
      honoApp = app;
    }

    super(logger, wsAdapter);

    if (!this.websocketAdapter.logger && logger) {
      this.websocketAdapter.logger = this.logger;
    }

    this._strict = typeof loggerOrOptions === 'object' && 'logger' in loggerOrOptions
      ? loggerOrOptions.strict ?? true
      : true;


    if (honoApp) {
      this.app = honoApp;
    } else {
      this.app = new Hono({ strict: this._strict });
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
  /**
   * Registers an HTML route for FrontendController pages.
   * HTML routes bypass the middleware chain and are served directly by Bun.serve().
   *
   * @param path - Full URL path (e.g., '/ui/home')
   * @param htmlBundle - The HTML bundle returned by importing an .html file
   */
  public registerHTMLRoute(
    path: string,
    htmlBundle: unknown,
    controllerName: string,
    controllerBasePath: string,
  ): void {
    if (this.htmlRoutes.has(path)) {
      throw new Error(`Duplicate HTML route: "${path}" is already registered.`);
    }

    this.htmlRoutes.set(path, htmlBundle);
    this.frontEndRouteQueue.push({ path, controllerName, controllerBasePath });

    // Register trailing slash variant for consistent routing
    if (path !== '/' && !path.endsWith('/')) {
      this.htmlRoutes.set(`${path}/`, htmlBundle);
    } else if (path !== '/' && path.endsWith('/')) {
      this.htmlRoutes.set(path.slice(0, -1), htmlBundle);
    }
  }

  public use(middleware: BaseMiddleware<HonoAdapterContext>, config?: GlobalMiddlewareRouteConfig) {
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

  public async start(options?: AsenaStartOptions) {
    // Register all queued routes with optimization
    if (!this.routesRegistered) {
      // Register global middlewares at top level BEFORE routes
      // This ensures they run for ALL requests including OPTIONS preflight
      this.registerGlobalMiddlewaresTopLevel();

      await this.optimizeAndRegisterRoutes();
      this.routesRegistered = true;
    }

    this.websocketAdapter.prepareWebSocket(this.options?.wsOptions);

    const serveConfig: any = {
      ...this.options.serveOptions,
      fetch: this.app.fetch,
      websocket: this.websocketAdapter.websocket,
    };

    if (options?.unix) {
      // Bun throws "Cannot specify both hostname and unix", and a port means nothing here
      serveConfig.unix = options.unix;
      delete serveConfig.hostname;
      delete serveConfig.port;
    } else {
      serveConfig.port = this.port;
    }

    // Add HTML routes if any are registered (FrontendController pages)
    // Bun checks routes first, then falls through to fetch (Hono) for API routes
    if (this.htmlRoutes.size > 0) {
      serveConfig.routes = Object.fromEntries(this.htmlRoutes);
    }


    this.server = bun.serve(serveConfig);

    this.websocketAdapter.startWebsocket(this.server);

    // Log controller-based route information
    if (this.routeQueue.length > 0 || this.wsRouteQueue.length > 0 || this.frontEndRouteQueue.length > 0) {
      this.logger.info('\n' + this.buildControllerBasedLog());
    }

    this.logger.info(
      options?.unix
        ? `Server running at unix:${options.unix}`
        : `Server running at http://localhost:${this.server.port}`,
    );

    return this.server;
  }

  /**
   * Registers global error handler with enhanced error handling capabilities
   *
   * Supports Hono's HTTPException for proper status code handling:
   * - HTTPException instances are passed to user handler for custom handling
   * - If user handler returns a response, it's used
   * - Otherwise, HTTPException's default response is returned
   * - Other errors follow normal error handling flow
   *
   * @param errorHandler - Custom error handler function
   *
   * @example
   * ```typescript
   * adapter.onError((error, context) => {
   *   // HTTPException handling (optional custom behavior)
   *   if (error instanceof HTTPException) {
   *     // Add custom logging or return custom response
   *     return context.send({ custom: 'response' }, error.status);
   *   }
   *
   *   // Other errors
   *   return context.send({ error: 'Internal error' }, 500);
   * });
   * ```
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

      // Wrap context for user handler
      const wrapper = new HonoContextWrapper(context, this.server);

      // Handle HTTPException with Hono's standard pattern
      if (error instanceof HTTPException) {
        try {
          // Allow user to customize HTTPException handling
          const customResponse = errorHandler(error, wrapper);

          // If user returned a response, use it
          if (customResponse) {
            return customResponse;
          }
        } catch (handlerError) {
          // User handler failed, log and fallback to HTTPException's default response
          this.logger.error('Error handler threw an error for HTTPException, using default response:', handlerError);
        }

        // Return HTTPException's default response (proper status code + message)
        return error.getResponse();
      }

      // Handle other errors through user-defined handler
      try {
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
    return middlewareParser(middlewares, () => this.server);
  }

  private prepareHandler(handler: HonoHandler): Handler {
    return (c: Context) => handler(new HonoContextWrapper(c, this.server));
  }

  /**
   * Prepares static serve options with enhanced features
   * @param staticServe - Base static serve parameters
   * @returns Configured static serve options for Hono
   */
  private prepareStaticServeOptions(staticServe: BaseStaticServeParams) {
    const staticServeOptions: {
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
          await staticServe.onFound.handler(path, new HonoContextWrapper(c, this.server));
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
        staticServeOptions.onNotFound = staticServe.onNotFound.handler;
      } else {
        staticServeOptions.onNotFound = (path, c: Context) => {
          staticServe.onNotFound.handler(path, new HonoContextWrapper(c, this.server));
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

        let schema: ZodType<any, any, any>;
        let hook: Hook<any, any, any> | undefined;

        if (typeof validationSchema === 'object' && 'schema' in validationSchema) {
          schema = validationSchema.schema;
          hook = validationSchema.hook;

          // Validate schema is actually a Zod schema
          if (!schema || typeof schema.parse !== 'function') {
            throw new Error(`Invalid Zod schema provided for '${key}' validator`);
          }
        } else {
          schema = validationSchema as ZodType<never, never, never>;

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
   * Registers global middlewares at the top level of the Hono app
   *
   * Must be called BEFORE route registration so middlewares run before route matching.
   * This ensures global middlewares (like CORS) handle all requests including
   * OPTIONS preflight requests that don't have explicit route handlers.
   *
   * Uses Hono's native path-based middleware registration:
   * - No config → app.use('*', mw)
   * - Only include patterns → app.use('/api/*', mw) per pattern
   * - Exclude patterns → runtime shouldApplyMiddleware check (Hono has no native exclude)
   */
  private registerGlobalMiddlewaresTopLevel(): void {
    for (const { middleware, config } of this.globalMiddlewares) {
      const parsed = middlewareParser([middleware], () => this.server);

      if (!config) {
        // No pattern filter → apply to all routes
        this.app.use('*', ...parsed);
      } else if (config.include && !config.exclude) {
        // Only include patterns → use Hono's native path matching
        for (const pattern of config.include) {
          this.app.use(pattern, ...parsed);
        }
      } else {
        // Exclude patterns exist → runtime filtering required
        this.app.use('*', async (c, next) => {
          if (shouldApplyMiddleware(new URL(c.req.url).pathname, config)) {
            for (const mw of parsed) {
              let called = false;

              await mw(c, async () => {
                called = true;
              });

              if (!called) return;
            }
          }

          await next();
        });
      }
    }
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
    const normalized = path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path;

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

      groups.get(basePath).push(route);
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
      // Sort routes by priority: static > param > wildcard, more specific first.
      // Hono matches in registration order — correct ordering prevents /:id
      // from catching static routes like /count or /search.
      // @see routePriority.ts for the segment-based comparison algorithm.
      this.routeQueue.sort((a, b) => compareRoutePriority(a.path, b.path));

      // Group routes by base path
      const routeGroups = this.groupRoutesByBasePath(this.routeQueue);

      // Sort groups by the same priority algorithm to ensure correct inter-group order
      const sortedGroups = [...routeGroups.entries()].sort(([a], [b]) => compareRoutePriority(a, b));

      for (const [basePath, routes] of sortedGroups) {
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
        `${green('✓')} Successfully registered ${yellow('CONTROLLER')} ${blue(controllerName)} ${yellow(`(${routeCount} ${routeText})`)}`,
      );
    }

    // Log WebSocket controllers (only those that don't have HTTP routes)
    for (const [controllerName, group] of wsGroups) {
      if (!httpGroups.has(controllerName)) {
        const routeCount = group.routes.length;
        const routeText = routeCount === 1 ? 'route' : 'routes';

        this.logger.info(
          `${green('✓')} Successfully registered ${yellow('WEBSOCKET')} ${blue(controllerName)} ${yellow(`(${routeCount} ${routeText})`)}`,
        );
      }
    }

    // Log FrontendControllers
    const frontEndGroups = this.groupFrontEndRoutesByController();

    for (const [controllerName, group] of frontEndGroups) {
      const routeCount = group.routes.length;
      const routeText = routeCount === 1 ? 'route' : 'routes';

      this.logger.info(
        `${green('✓')} Successfully registered ${yellow('FRONTEND')} ${blue(controllerName)} ${yellow(`(${routeCount} ${routeText})`)}`,
      );
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

    const normalizedWsPath = this.normalizePath(`/${wsRoute.path}`);

    (this.app as any).get(normalizedWsPath, ...allMiddlewares, async (c: Context, next) => {
      const websocketData = c.get('_websocketData') || {};

      const id = bun.randomUUIDv7();

      const dataPath = normalizedWsPath.startsWith('/') ? normalizedWsPath.slice(1) : normalizedWsPath;
      const data: WebSocketData = { values: websocketData, id, path: dataPath };
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

    const group = new Hono({ strict: this._strict });

    // Global middlewares are registered at top level via registerGlobalMiddlewaresTopLevel()

    // Apply common middlewares to the entire group
    const preparedCommonMiddlewares = this.prepareMiddlewares(commonMiddlewares);

    if (preparedCommonMiddlewares.length > 0) {
      group.use('*', ...preparedCommonMiddlewares);
    }

    // Method map for group
    const groupMethodMap = {
      [HttpMethod.GET]: (path: string, ...handlers: any[]) => (group as any).get(path, ...handlers),
      [HttpMethod.POST]: (path: string, ...handlers: any[]) => (group as any).post(path, ...handlers),
      [HttpMethod.PUT]: (path: string, ...handlers: any[]) => (group as any).put(path, ...handlers),
      [HttpMethod.DELETE]: (path: string, ...handlers: any[]) => (group as any).delete(path, ...handlers),
      [HttpMethod.PATCH]: (path: string, ...handlers: any[]) => (group as any).patch(path, ...handlers),
      [HttpMethod.OPTIONS]: (path: string, ...handlers: any[]) => (group as any).options(path, ...handlers),
      [HttpMethod.CONNECT]: (path: string, ...handlers: any[]) =>
        (group as any).on([HttpMethod.CONNECT.toUpperCase()], path, ...handlers),
      // HEAD is handled automatically by Hono via GET routes (HTTP spec: HEAD = GET without body).
      [HttpMethod.HEAD]: (path: string, ...handlers: any[]) => (group as any).get(path, ...handlers),
      [HttpMethod.TRACE]: (path: string, ...handlers: any[]) =>
        (group as any).on([HttpMethod.TRACE.toUpperCase()], path, ...handlers),
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

      const methodHandler =
        groupMethodMap[route.method] ??
        ((path: string, ...handlers: any[]) => (group as any).on([route.method.toUpperCase()], path, ...handlers));


      // Calculate relative path
      let relativePath = route.path;

      if (route.path.startsWith(basePath) && basePath !== '/') {
        relativePath = route.path.slice(basePath.length);
      }

      if (!relativePath.startsWith('/')) {
        relativePath = '/' + relativePath;
      }

      // Normalize path for Hono trailing slash compatibility
      const normalizedRelativePath = this.normalizePath(relativePath);

      // Register to group
      if (route.staticServe) {
        methodHandler(normalizedRelativePath, ...allMiddlewares, serveStatic(this.prepareStaticServeOptions(route.staticServe)));
      } else {
        const handler = this.prepareHandler(route.handler);

        methodHandler(normalizedRelativePath, ...allMiddlewares, handler);
      }
    }

    // Mount group to main app (normalize basePath too)
    this.app.route(this.normalizePath(basePath), group);
  }

  /**
   * Registers a single route directly without grouping
   */
  private async registerRouteDirect(
    route: RouteParams<HonoAdapterContext, ValidationSchema, StaticServeExtras>,
  ): Promise<void> {

    const preparedMiddlewares = this.prepareMiddlewares(route.middlewares || []);
    const validators = route.validator ? await this.prepareValidator(route.validator) : [];

    // Global middlewares are registered at top level via registerGlobalMiddlewaresTopLevel()
    const allMiddlewares = [...validators, ...preparedMiddlewares];

    const methodHandler =
      this.methodMap[route.method] ??
      ((path: string, ...handlers: any[]) => (this.app as any).on([route.method.toUpperCase()], path, ...handlers));


    // Normalize path for Hono: strip trailing slash (except root '/')
    // Hono strict:false strips trailing slash from incoming requests,
    // so registered paths must also not have trailing slash to match.
    const normalizedPath = this.normalizePath(route.path);

    if (route.staticServe) {
      methodHandler(normalizedPath, ...allMiddlewares, serveStatic(this.prepareStaticServeOptions(route.staticServe)));
    } else {
      const handler = this.prepareHandler(route.handler);

      methodHandler(normalizedPath, ...allMiddlewares, handler);
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
  private groupRoutesByController(): Map<string, { basePath: string; routes: { method: string; path: string }[] }> {
    const groups = new Map<string, { basePath: string; routes: { method: string; path: string }[] }>();

    for (const route of this.routeQueue) {
      const controllerName = route.controllerName || 'Unknown';
      const controllerBasePath = route.controllerBasePath || '/';

      if (!groups.has(controllerName)) {
        groups.set(controllerName, {
          basePath: controllerBasePath,
          routes: [],
        });
      }

      groups.get(controllerName).routes.push({
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
  private groupWebSocketRoutesByController(): Map<string, { basePath: string; routes: { path: string }[] }> {
    const groups = new Map<string, { basePath: string; routes: { path: string }[] }>();

    for (const wsRoute of this.wsRouteQueue) {
      const controllerName = wsRoute.controllerName || 'Unknown';
      const controllerBasePath = wsRoute.path; // WebSocket uses path as base path

      if (!groups.has(controllerName)) {
        groups.set(controllerName, {
          basePath: controllerBasePath,
          routes: [],
        });
      }

      groups.get(controllerName).routes.push({
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
        const httpGroup = httpGroups.get(controllerName);

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

    // Add FrontendController groups
    const frontEndGroups = this.groupFrontEndRoutesByController();
    const sortedFrontEnd = Array.from(frontEndGroups.entries()).sort(([a], [b]) => a.localeCompare(b));

    for (const [controllerName, group] of sortedFrontEnd) {
      lines.push(`  ${blue(controllerName)} ${yellow(`(${group.basePath})`)}`);

      for (const route of group.routes) {
        lines.push(`    ${green('HTML')} ${route.path}`);
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Groups FrontendController routes by controller name for logging
   */
  private groupFrontEndRoutesByController(): Map<string, { basePath: string; routes: { path: string }[] }> {
    const groups = new Map<string, { basePath: string; routes: { path: string }[] }>();

    for (const route of this.frontEndRouteQueue) {
      if (!groups.has(route.controllerName)) {
        groups.set(route.controllerName, {
          basePath: route.controllerBasePath,
          routes: [],
        });
      }

      groups.get(route.controllerName).routes.push({ path: route.path });
    }

    return groups;
  }
}
