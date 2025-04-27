import type { AsenaHandler, ErrorHandler } from '@asenajs/asena/adapter';
import type { Context } from '../defaults';

export type HonoHandler = AsenaHandler<Context>;
export type HonoErrorHandler = ErrorHandler<Context>;
