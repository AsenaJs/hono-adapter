import type { z } from "zod";
import type { Hook } from "@hono/zod-validator";
import type { AsenaValidationService } from "@asenajs/asena/middleware";

export type ValidationSchema = z.ZodType<any, z.ZodTypeDef, any>;

export interface ValidationSchemaWithHook {
  schema: z.ZodType<any, z.ZodTypeDef, any>;
  hook?: Hook<any, any, any>;
}

export abstract class ValidationService
  implements
    AsenaValidationService<ValidationSchema | ValidationSchemaWithHook> {}
