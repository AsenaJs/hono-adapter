import type { Context, MiddlewareHandler, Next } from 'hono';
import { HonoContextWrapper } from '../HonoContextWrapper';
import { createFactory } from 'hono/factory';
import type { Context as HonoAdapterContext } from '../defaults';
import type { BaseMiddleware } from '@asenajs/asena/adapter';

export const middlewareParser = (middlewares: BaseMiddleware<HonoAdapterContext>[]): MiddlewareHandler[] => {
  const factory = createFactory();

  return middlewares.map((middleware) => {
    if (middleware.override) {
      // @ts-ignore
      return (c: Context, next: Function) => middleware.handle(c, next);
    }

    return factory.createMiddleware(async (context: Context, next: Next) => {
      await middleware.handle(new HonoContextWrapper(context), next);
    });
  });
};
