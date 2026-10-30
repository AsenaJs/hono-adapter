import type { HonoRequest } from 'hono';
import type { AsenaContext } from '@asenajs/asena/adapter';

// Hono requires request input to be an object-like value or undefined.
export type Context<
  P extends string = any,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  I extends {} | undefined = any,
  R extends Response = Response,
> = AsenaContext<HonoRequest<P, I>, R>;

import { defineContext } from '../defineContext';
export const Context = { define: defineContext };
