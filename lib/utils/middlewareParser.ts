import type { Context, MiddlewareHandler, Next } from 'hono';
import { HonoContextWrapper } from '../HonoContextWrapper';
import { createFactory } from 'hono/factory';
import type { Context as HonoAdapterContext } from '../defaults';
import type { BaseMiddleware } from '@asenajs/asena/adapter';

/**
 * Parses Asena middlewares to Hono middleware format with optimizations
 * - Reuses context wrappers when possible
 * - Handles middleware return values (false stops pipeline)
 * - Adds error handling
 */
export const middlewareParser = (middlewares: BaseMiddleware<HonoAdapterContext>[]): MiddlewareHandler[] => {
  const factory = createFactory();

  return middlewares.map((middleware) => {
    if (middleware.override) {
      // @ts-ignore - Allow override middleware to use raw Hono context
      return (c: Context, next: Function) => middleware.handle(c, next);
    }

    return factory.createMiddleware(async (context: Context, next: Next) => {
      // Reuse wrapper if already exists in context (performance optimization)
      let wrapper = context.get('_asenaContextWrapper') as HonoContextWrapper;

      if (!wrapper) {
        wrapper = new HonoContextWrapper(context);
        context.set('_asenaContextWrapper', wrapper);
      }

      // eslint-disable-next-line no-useless-catch
      try {
        // Call middleware handler
        const result = await middleware.handle(wrapper, next);

        // If middleware returns false, stop the pipeline
        if (result === false) {
          return;
        }

        // If middleware returns Response, return it to Hono
        // This allows middleware to short-circuit the chain (like Hono's built-in CORS)
        if (result instanceof Response) {
          return result;
        }

        // If middleware didn't call next(), we call it here
        // Note: Hono middleware should handle next() calls properly
      } catch (error) {
        // Let Hono's error handler catch it
        throw error;
      }
    });
  });
};
