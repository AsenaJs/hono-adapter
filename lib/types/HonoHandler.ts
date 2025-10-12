import type { AsenaHandler, ErrorHandler } from '@asenajs/asena/adapter';
import type { Context } from '../defaults';

export type HonoHandler = AsenaHandler<Context>;
export type HonoErrorHandler = ErrorHandler<Context>;

/**
 * Typed route handler for better type inference
 */
export type TypedHonoHandler<TBody = unknown, TResponse = any> = (
  context: Context & { req: { json: () => Promise<TBody> } },
) => Promise<TResponse> | TResponse;
