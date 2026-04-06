import type { z } from 'zod';
import type { Hook } from '@hono/zod-validator';
import type { AsenaValidationService } from '@asenajs/asena/middleware';

export type ValidationSchema = z.ZodType<any, any, any>;

export interface ValidationSchemaWithHook<T extends z.ZodType = z.ZodType> {
  schema: T;
  hook?: Hook<z.input<T>, any, any>;
}

export abstract class ValidationService
  implements AsenaValidationService<ValidationSchema | ValidationSchemaWithHook> {}
