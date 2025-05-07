import type { HonoRequest } from 'hono';
import type { AsenaContext } from '@asenajs/asena/adapter';

export type Context<P extends string = any, I = any, R extends Response = Response> = AsenaContext<
  HonoRequest<P, I>,
  R
>;
