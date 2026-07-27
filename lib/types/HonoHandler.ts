import type { AsenaHandler, ErrorHandler, NotFoundHandler } from '@asenajs/asena/adapter';
import type { Context } from '../defaults';

export type HonoHandler = AsenaHandler<Context>;
export type HonoErrorHandler = ErrorHandler<Context>;
export type HonoNotFoundHandler = NotFoundHandler<Context>;

/**
 * Typed route handler for better type inference
 */
export type TypedHonoHandler<TBody = unknown, TResponse = any> = (
  context: Context & { req: { json: () => Promise<TBody> } },
) => Promise<TResponse> | TResponse;
