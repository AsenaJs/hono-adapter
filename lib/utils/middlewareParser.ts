import type { Server } from 'bun';
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
 *
 * @param middlewares - Asena middlewares to convert
 * @param getServer - Lazy server getter (server available at request time, not registration time)
 */
export const middlewareParser = (
  middlewares: BaseMiddleware<HonoAdapterContext>[],
  getServer?: () => Server<never> | undefined,
): MiddlewareHandler[] => {
  const factory = createFactory();

  return middlewares.map((middleware) => {
    if (middleware.override) {
      // @ts-expect-error - Allow override middleware to use raw Hono context
      return (c: Context, next: Function) => middleware.handle(c, next);
    }

    return factory.createMiddleware(async (context: Context, next: Next) => {
      // Reuse wrapper if already exists in context (performance optimization)
      let wrapper = context.get('_asenaContextWrapper') as HonoContextWrapper;

      if (!wrapper) {
        wrapper = new HonoContextWrapper(context, getServer?.());
        context.set('_asenaContextWrapper', wrapper);
      }

      // eslint-disable-next-line no-useless-catch
      try {
        // Call middleware handler
        const result = await middleware.handle(wrapper, next);

        // If middleware returns false, stop the pipeline and return 403
        // (consistent with Ergenecore adapter behavior)
        if (result === false) {
          context.res = new Response('Forbidden', { status: 403 });

          return;
        }

        // If middleware returns Response, set it on the Hono context.
        // Raw Response return may not propagate through factory.createMiddleware,
        // so we set c.res directly to ensure Hono uses this response.
        if (result instanceof Response) {
          context.res = new Response(result.body, {
            status: result.status,
            headers: result.headers,
          });

          return;
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
