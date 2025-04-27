import { AsenaMiddlewareService } from '@asenajs/asena/middleware';
import type { HonoRequest } from 'hono';
import type { AsenaContext } from '@asenajs/asena/adapter';

export abstract class MiddlewareService<P extends string = any, I = any> extends AsenaMiddlewareService<
  AsenaContext<HonoRequest<P, I>, Response>
> {}
