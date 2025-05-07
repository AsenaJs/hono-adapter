import { type Context, type Handler, Hono, type MiddlewareHandler, type ValidationTargets } from 'hono';
import type { Server } from 'bun';
import * as bun from 'bun';
import { HonoContextWrapper } from './HonoContextWrapper';
import type { AsenaWebsocketAdapter, BaseStaticServeParams, WebsocketRouteParams } from '@asenajs/asena/adapter';
import {
  AsenaAdapter,
  type AsenaServeOptions,
  type BaseMiddleware,
  type BaseValidator,
  type RouteParams,
  VALIDATOR_METHODS,
  type ValidatorHandler,
} from '@asenajs/asena/adapter';
import type { HonoErrorHandler, HonoHandler, StaticServeExtras } from './types';
import { green, type ServerLogger, yellow } from '@asenajs/asena/logger';
import { type Hook, zValidator } from '@hono/zod-validator';
import type { ValidationSchema, ValidationSchemaWithHook } from './defaults';
import type { ZodType, ZodTypeDef } from 'zod';
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

  public use(middleware: BaseMiddleware<HonoAdapterContext>, path?: string) {
    const normalizedPath = path ? this.normalizePath(path) : undefined;
    const preparedMiddlewares = this.prepareMiddlewares([middleware]);

    if (normalizedPath) {
      this.app.use(normalizedPath, ...preparedMiddlewares);
      return;
    }

    this.app.use(...preparedMiddlewares);
  }

  public async registerRoute({
    method,
    path,
    middlewares,
    handler,
    staticServe,
    validator,
  }: RouteParams<HonoAdapterContext, ValidationSchema, StaticServeExtras>) {
    const prepareMiddlewares = this.prepareMiddlewares(middlewares);

    const allMiddlewares: MiddlewareHandler[] = validator
      ? [...(await this.prepareValidator(validator)), ...prepareMiddlewares]
      : prepareMiddlewares;

    const methodHandler = this.methodMap[method];

    if (!methodHandler) {
      throw new Error('Invalid method');
    }

    if (staticServe) {
      methodHandler(path, ...allMiddlewares, serveStatic(this.prepareStaticServeOptions(staticServe)));

      this.logger.info(
        `${green('Successfully')} registered ${yellow('Static Serve ' + method.toUpperCase())} route for PATH: ${green(`${path}`)}`,
      );
      return;
    }

    const routeHandler = [...allMiddlewares, this.prepareHandler(handler)];

    methodHandler(path, ...routeHandler);
    this.logger.info(
      `${green('Successfully')} registered ${yellow(method.toUpperCase())} route for PATH: ${green(`${path}`)}`,
    );
  }

  public registerWebsocketRoute({
    path,
    websocketService,
    middlewares,
  }: WebsocketRouteParams<HonoAdapterContext>): Promise<void> | void {
    const preparedMiddlewares = this.prepareMiddlewares(middlewares);

    this.app.get(`/${path}`, ...preparedMiddlewares, async (c: Context, next) => {
      const websocketData = c.get('_websocketData') || {};

      const id = bun.randomUUIDv7();

      const data: WebSocketData = { values: websocketData, id, path: path };
      const upgradeResult = this.server.upgrade(c.req.raw, { data });

      if (upgradeResult) {
        return new Response(null);
      }

      await next(); // Failed
    });

    this.websocketAdapter.registerWebSocket(websocketService);
  }

  public async start() {
    this.websocketAdapter.prepareWebSocket(this.options?.wsOptions);

    this.server = bun.serve({
      ...this.options.serveOptions,
      port: this.port,
      fetch: this.app.fetch,
      websocket: this.websocketAdapter.websocket,
    });

    this.websocketAdapter.startWebsocket(this.server);
    return this.server;
  }

  public onError(errorHandler: HonoErrorHandler) {
    this.app.onError((error, context) => {
      return errorHandler(error, new HonoContextWrapper(context));
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
        staticServeOptions.onFound = (path, c: Context) => {
          staticServe.onFound.handler(path, new HonoContextWrapper(c));
        };
      }
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

  private async prepareValidator(
    baseValidator: BaseValidator<ValidationSchema | ValidationSchemaWithHook>,
  ): Promise<MiddlewareHandler[]> {
    if (!baseValidator) {
      return [];
    }

    const validators = [];

    for (const key of VALIDATOR_METHODS) {
      // if the key is not a validator method, skip
      if (typeof (baseValidator[key] as BaseMiddleware<HonoAdapterContext>)?.handle !== 'function') {
        continue;
      }

      const validator: ValidatorHandler<ValidationSchema | ValidationSchemaWithHook> = baseValidator[key];

      const validationSchema = await validator.handle();
      let schema: ZodType<any, ZodTypeDef, any>;
      let hook: Hook<any, any, any>;

      if ('schema' in validationSchema) {
        schema = validationSchema['schema'];
        hook = validationSchema['hook'];
      } else {
        schema = validationSchema as ZodType<any, ZodTypeDef, any>;
      }

      validators.push(zValidator(key as keyof ValidationTargets, schema, hook));
    }

    return validators;
  }

  private normalizePath(path: string): string {
    return `${path.endsWith('/') ? path : `${path}/`}*`;
  }

}
