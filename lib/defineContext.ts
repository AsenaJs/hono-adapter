import {
  ASENA_CONTEXT_CONTRACT,
  ASENA_CONTEXT_ADAPTER,
  defineRequestSchemas,
  type RequestSchemas,
  type ExactRequestSchemas,
  type InferInputs,
} from '@asenajs/asena/adapter';
import { HonoContextWrapper } from './HonoContextWrapper';

export interface DefinedContext<S extends RequestSchemas> {
  new (...args: ConstructorParameters<typeof HonoContextWrapper>): HonoContextWrapper<InferInputs<S>>;
  readonly [ASENA_CONTEXT_CONTRACT]: Readonly<S>;
  readonly [ASENA_CONTEXT_ADAPTER]: string;
}

export function defineContext<const S extends RequestSchemas>(schemas: ExactRequestSchemas<S>): DefinedContext<S> {
  const contract = defineRequestSchemas(schemas);
  return class RouteContext extends HonoContextWrapper<InferInputs<S>> {
    public static readonly [ASENA_CONTEXT_CONTRACT] = contract;
    public static readonly [ASENA_CONTEXT_ADAPTER] = 'hono-adapter';
  };
}
