import type { z } from 'zod';
import type { ValidationTargets } from 'hono';
import type { Hook } from '@hono/zod-validator';
import type { AsenaValidationService } from '@asenajs/asena/middleware';

export type ValidationSchema = z.ZodType<any, any, any>;

export interface ValidationSchemaWithHook<T extends z.ZodType = z.ZodType> {
  schema: T;

  /**
   * Runs on every validation attempt, successful or not - `result` is the Zod
   * `SafeParseResult` (`{ success, data | error }`), not the parsed data.
   *
   * Return a `Response` (or `{ response }`) to answer the request yourself; return
   * nothing to let the adapter's default handling continue, which reports the failure
   * through `ConfigService.onError`. Passing the schema as the last type argument
   * types `result.error` against that schema instead of the untyped union.
   */
  hook?: Hook<z.input<T>, any, any, keyof ValidationTargets, object, T>;
}

export abstract class ValidationService implements AsenaValidationService<
  ValidationSchema | ValidationSchemaWithHook
> {}
