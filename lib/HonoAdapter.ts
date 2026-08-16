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
  isHttpException,
  type RouteParams,
  VALIDATOR_METHODS,
  type ValidatorHandler,
} from '@asenajs/asena/adapter';
import type { GlobalMiddlewareConfig, GlobalMiddlewareRouteConfig } from '@asenajs/asena/server/config';
import { shouldApplyMiddleware } from '@asenajs/asena/utils';
import type {
  HonoAdapterOptions,
  HonoErrorHandler,
  HonoHandler,
  HonoNotFoundHandler,
  StaticServeExtras,
} from './types';
import { blue, green, red, type ServerLogger, yellow } from '@asenajs/asena/logger';
import { type Hook, zValidator } from '@hono/zod-validator';
import type { ValidationSchema, ValidationSchemaWithHook } from './defaults';
import type { ZodError, ZodType } from 'zod';
import { brandHonoHttpException, ValidationError, warnOnNestedHono } from './errors';
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

  private readonly logErrors: boolean = true;

  private server: Server<WebSocketData>;

  private options: AsenaServeOptions = {} satisfies AsenaServeOptions;

  /**
   * Whether the *application* registered an error handler. Read only by `start()`, to decide
   * whether the framework's own default needs registering - Hono keeps a single `onError`, so
   * registering both would replace the application's.
   */
  private hasErrorHandler = false;

  /** Whether the application registered an onNotFound hook (see start()) */
  private hasNotFoundHandler = false;

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

  /**
   * Stops the HTTP surface and releases everything the adapter owns.
   *
   * The socket goes down first and the WebSocket adapter is torn down after it, for the same
   * reason the core stops the adapter before running `@OnStop`: a transport has to outlive the
   * things that publish through it. Destroying it while a message handler is still running would
   * only turn a shutdown into an error in the log.
   *
   * `finally`, so the two failure directions are both covered - a `server.stop()` that rejects
   * still releases the WebSocket resources, and a WebSocket teardown that fails cannot leave the
   * port bound. A port that survives `stop()` is how a test suite starts failing with
   * EADDRINUSE and how a rolling deploy keeps taking traffic it can no longer serve.
   *
   * @param closeActiveConnections - Whether to drop in-flight connections instead of draining them
   */
  public async stop(closeActiveConnections = true): Promise<void> {
    try {
      if (this.server) {
        await this.server.stop(closeActiveConnections);
      }
    } finally {
      // Cast because `AsenaWebsocketAdapter` does not declare `shutdown()` - the constructor only
      // ever accepts a HonoWebsocketAdapter, so the narrowing is the one the public API already
      // guarantees.
      const websocketAdapter = this.websocketAdapter as HonoWebsocketAdapter | undefined;

      // Guarded rather than awaited bare: shutdown() already contains its own failures, but a
      // throw from here would replace whatever `server.stop()` was reporting.
      try {
        await websocketAdapter?.shutdown();
      } catch (error) {
        this.logger.error('WebSocket shutdown failed during adapter stop:', error);
      }
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

    const isOptionsObject = typeof loggerOrOptions === 'object' && 'logger' in loggerOrOptions;

    this._strict = isOptionsObject ? (loggerOrOptions.strict ?? true) : true;
    this.logErrors = isOptionsObject ? (loggerOrOptions.logErrors ?? true) : true;

    if (honoApp) {
      this.app = honoApp;
    } else {
      this.app = new Hono({ strict: this._strict });
    }

    // Teach isHttpException() about Hono's own exception class. Doing it here rather than at
    // module scope keeps the side effect tied to actually using the adapter.
    brandHonoHttpException();

    // ...and say so if that branding cannot possibly be enough, because `hono` resolved to a copy
    // nested under this package rather than to the application's own.
    warnOnNestedHono(this.logger);
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

    // Unconditional 404 default, so an app with no config still answers the same envelope
    // ergenecore does instead of Hono's text/plain. A registered onNotFound has already
    // replaced this - Hono keeps only the last notFound handler, and prepareConfigs runs
    // during APPLICATION_SETUP, before start().
    if (!this.hasNotFoundHandler) {
      this.app.notFound((context) => this.defaultNotFoundResponse(context.req.path, context.req.method));
    }

    // Same reasoning, for errors. `onError` was registered only when the application declared the
    // hook, so an app with no config answered a 500 and wrote nothing to the ServerLogger: Hono's
    // built-in handler dumps a bare stack to stderr with no path, method or status, `logErrors:
    // false` could not suppress it, and a 4xx produced no output at all.
    if (!this.hasErrorHandler) {
      this.app.onError((error, context) => this.defaultErrorResponse(error, context.req.path, context.req.method));
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
      // Bun checks `routes` before falling through to `fetch`, so a page registered on a path an
      // API route also serves silently shadows it: the request answers 200 with the HTML and the
      // API route becomes unreachable while still appearing in the startup log. Ergenecore
      // rejects the same collision at startup; match it rather than ship a route that exists in
      // the logs and not on the wire.
      const reservedPaths = new Set<string>([
        ...this.routeQueue.map((route) => route.path),
        ...this.wsRouteQueue.map((route) => (route.path.startsWith('/') ? route.path : `/${route.path}`)),
      ]);

      for (const htmlPath of this.htmlRoutes.keys()) {
        if (reservedPaths.has(htmlPath)) {
          throw new Error(
            `HTML route collision at "${htmlPath}": path already registered as an API or WebSocket route.`,
          );
        }
      }

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
   * Registers the handler for requests that match no route.
   *
   * Separate from {@link onError}: an unmatched route is a routing outcome, not a thrown error,
   * so the application's error handler never sees one and never has to discriminate.
   *
   * @param notFoundHandler - Handler that produces the 404 response
   */
  public onNotFound(notFoundHandler: HonoNotFoundHandler) {
    this.hasNotFoundHandler = true;

    this.app.notFound(async (context) => {
      const wrapper = new HonoContextWrapper(context, this.server);

      try {
        const response = await notFoundHandler(wrapper, {
          path: context.req.path,
          method: context.req.method,
        });

        if (response instanceof Response) {
          // The application answered its own 404 - it already knows about the request.
          return response;
        }
      } catch (error) {
        // onNotFound must not be able to take the server down, and it is deliberately NOT
        // routed to onError - that hook is for errors the application threw itself.
        this.logger.error('onNotFound threw an error, using the default response:', error);
      }

      return this.defaultNotFoundResponse(context.req.path, context.req.method);
    });
  }

  /**
   * The 404 both adapters answer when no `onNotFound` is registered, and the log line that goes
   * with it.
   *
   * Hono's own default is `text/plain`, so the same application used to produce a different
   * body depending on which adapter it ran under - the specific complaint that started this
   * work. Registered unconditionally in `start()` so the default holds even for an app with
   * no config at all.
   *
   * `info`, not `warn`: a scanner walking /wp-admin, /.env and /phpmyadmin must not be able to
   * fill the warning stream. Not `debug` either - a 404 nobody can see is how a mistyped route
   * survives to production. Only reached when the framework is the one answering, so an
   * application that shaped its own 404 gets no line from here.
   */
  private defaultNotFoundResponse(path: string, method: string): Response {
    if (this.logErrors !== false) {
      this.logger.info('Route not found:', { path, method, status: 404 });
    }

    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Registers the application's global error handler.
   *
   * Every error the application throws is offered to it first, `HTTPException` included, so an
   * application can reshape its own 401/403/429 envelopes rather than only the 500s. Returning
   * nothing means "not mine, use the default" - the framework then answers, and logs.
   *
   * @param errorHandler - Handler that produces the response for a thrown error
   *
   * @example
   * ```typescript
   * adapter.onError((error, context) => {
   *   if (isHttpException(error)) {
   *     return context.send({ error: error.message }, error.status);
   *   }
   *
   *   return context.send({ error: 'Internal error' }, 500);
   * });
   * ```
   */
  public onError(errorHandler: HonoErrorHandler) {
    this.hasErrorHandler = true;

    this.app.onError(async (error, context) => {
      // Wrap context for user handler
      const wrapper = new HonoContextWrapper(context, this.server);

      try {
        const customResponse = await errorHandler(error, wrapper);

        // A handler that returns nothing is saying "not mine, use the default" - the contract
        // ergenecore's `respondToError` already implements. Matched on the type rather than on
        // truthiness because an async handler that declines still returns a truthy Promise.
        if (customResponse instanceof Response) {
          // The application answered. Its handler is where this error gets recorded, with
          // whatever correlation id the application carries - a second line from the adapter
          // would only duplicate it.
          return customResponse;
        }
      } catch (handlerError) {
        // The `await` above is what brings a rejecting handler here rather than letting it escape
        // as an unhandled rejection.
        this.logger.error('Error handler threw an error, using the default response:', handlerError);
      }

      return this.defaultErrorResponse(error, context.req.path, context.req.method);
    });
  }

  /**
   * The response the framework itself answers with, and the log line that goes with it.
   *
   * Reached when the application declared no `onError`, when its handler declined by returning
   * nothing, or when the handler threw. All three mean the framework is producing the response,
   * so it is the framework that has to record what happened - otherwise an `onError` that
   * returns `undefined` swallows a 500 with no trace anywhere.
   *
   * The body is the same one `@asenajs/ergenecore` answers. It used to be `text/plain` for an
   * application with no config and `{error, message, timestamp}` for one whose handler declined,
   * so the same failure produced three different envelopes across the two adapters.
   */
  private defaultErrorResponse(error: Error, path: string, method: string): Response {
    this.logHandledError(error, path, method);

    // Hono's own class first, and deliberately by `instanceof` rather than by the brand. The brand
    // reaches it only because `brandHonoHttpException()` patched the prototype from this class's
    // constructor; if that call is ever removed, reordered, or defeated by `hono/http-exception`
    // resolving to a second copy inside a middleware, every 401 from `hono/basic-auth`,
    // `hono/bearer-auth`, `hono/jwt` and hono's own validator would silently answer 500. This arm
    // costs one check and cannot be defeated that way.
    if (error instanceof HTTPException) {
      return error.getResponse();
    }

    if (isHttpException(error)) {
      // The class from `@asenajs/asena/adapter` - the one applications throw on both adapters -
      // and any foreign copy that still carries a way to build its own response.
      if (typeof error.getResponse === 'function') {
        return error.getResponse();
      }

      // Branded, but with nothing to build a response from. Only `status` is in the contract, so
      // honour that and withhold the body: an exception this adapter does not recognise is not
      // known to carry a message that is safe to send to the caller.
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: error.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * The status the caller will be answered with, for anything thrown.
   *
   * Shared by `defaultErrorResponse` and `logHandledError` so the response and the log line cannot
   * disagree. They used to: the response was chosen by `instanceof HTTPException` while the log
   * level was chosen by duck-typing a numeric `status` off the error. A plain `Error` carrying a
   * stray `.status = 401` was therefore answered 500 and logged at debug as a 4xx, and a branded
   * exception from a second copy was answered 500 and logged as whatever status it carried.
   */
  private resolveErrorStatus(error: unknown): number {
    if (error instanceof HTTPException) return error.status;

    if (isHttpException(error)) return error.status;

    return 500;
  }

  /**
   * Logs an error that is about to be handed to the application's error handler.
   *
   * The level is derived from the status the client will actually see - via the same
   * `resolveErrorStatus` the response uses, so the two cannot drift. A 4xx is the caller's
   * mistake and the auth/validation layer doing its job, so it must not flood the ERROR stream
   * with stack traces - an unauthenticated request would otherwise be an attacker-controlled log
   * amplifier. Only 5xx carries a stack, because that is the class of failure nobody predicted.
   *
   * `ServerLogger.debug` is optional, so fall back to `info` when an implementation does
   * not provide it.
   */
  private logHandledError(error: Error, path: string, method: string): void {
    if (this.logErrors === false) return;

    const status = this.resolveErrorStatus(error);
    const isServerError = status >= 500;

    const meta = {
      message: error.message,
      path,
      method,
      status,
      ...(isServerError ? { stack: error.stack } : {}),
    };

    if (isServerError) {
      this.logger.error('Application error occurred:', meta);

      return;
    }

    // `debug` is optional on ServerLogger, and older @asenajs/asena typings do not declare
    // it at all - read it structurally and fall back to info.
    const debug = (this.logger as { debug?: (message: string, meta?: any) => void }).debug;

    (debug ?? this.logger.info).call(this.logger, 'Request rejected:', meta);
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

        // The user hook runs first and wins if it answers the request, but it no
        // longer *replaces* the default handling: a hook added for logging or
        // context enrichment used to silently change that route's error contract
        const validator = zValidator(key as keyof ValidationTargets, schema, async (result, c) => {
          if (hook) {
            const hookResult = await hook(result, c);

            // Only the two forms zValidator itself honours short-circuit here; anything
            // else falls through to the default so the contract stays consistent
            if (hookResult instanceof Response) {
              return hookResult;
            }

            if (hookResult && typeof hookResult === 'object' && 'response' in hookResult) {
              return hookResult;
            }
          }

          if (result.success) {
            return;
          }

          // zValidator intersects the result union with `{ target }`, which stops TS
          // narrowing it on `success`. The error type is also widened to a
          // `$ZodError | ZodError` union because zValidator accepts zod-core schemas;
          // ours are always classic `z.ZodType` (see ValidationSchema), so the runtime
          // value is a classic ZodError.
          const { error } = result as unknown as { error: ZodError };

          return this.handleValidationFailure(error, key);
        });

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
   * @description Answer a failed validation.
   *
   * Throws a `ValidationError` so the failure travels the same path as every other error and
   * reaches `ConfigService.onError`, which is what the documentation has always described.
   *
   * The adapter used to answer its own 400 here when no error handler was configured, which made
   * a validation failure the one 4xx that reached neither `onError` nor the log. That envelope
   * did not disappear with the branch - it moved onto `ValidationError.getResponse()`, which
   * `defaultErrorResponse` falls back to.
   * @param {ZodError} error - The Zod failure
   * @param {string} target - Which part of the request failed
   * @returns {never} Always throws
   */
  private handleValidationFailure(error: ZodError, target: string): never {
    throw new ValidationError(error, target);
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
   * Sorts the queued routes and registers each one with its own middlewares.
   *
   * There used to be a "common middleware" optimisation here: routes sharing a base path were
   * mounted on a sub-app and the middlewares they had in common were hoisted to `group.use('*')`.
   * It compared middlewares with `mw.constructor.name`, but by this point a middleware is the
   * plain `{ handle, override }` literal PrepareMiddlewareService builds - so the name was
   * `"Object"` for every one of them and the comparison was always true. Every route in a group
   * got the *first* route's middlewares and had its own filtered away, which silently swapped
   * authorisation guards between sibling routes. Measured at 100 routes it bought nothing, so
   * it is gone rather than repaired.
   */
  private async optimizeAndRegisterRoutes(): Promise<void> {
    // Register HTTP routes
    if (this.routeQueue.length > 0) {
      // Sort routes by priority: static > param > wildcard, more specific first.
      // Hono matches in registration order — correct ordering prevents /:id
      // from catching static routes like /count or /search.
      // @see routePriority.ts for the segment-based comparison algorithm.
      this.routeQueue.sort((a, b) => compareRoutePriority(a.path, b.path));

      for (const route of this.routeQueue) {
        await this.registerRouteDirect(route);
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
