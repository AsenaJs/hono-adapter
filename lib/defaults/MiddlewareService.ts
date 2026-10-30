import { AsenaMiddlewareService } from '@asenajs/asena/middleware';
import type { HonoRequest } from 'hono';
import type { AsenaContext } from '@asenajs/asena/adapter';

// Hono requires request input to be an object-like value or undefined.
export abstract class MiddlewareService<
  P extends string = any,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  I extends {} | undefined = any,
> extends AsenaMiddlewareService<AsenaContext<HonoRequest<P, I>, Response>> {}
