import { HTTPException } from 'hono/http-exception';
import { VALIDATION_ERROR, type ValidationErrorLike, type ValidationIssue } from '@asenajs/asena/adapter';
import type { ZodError } from 'zod';

/**
 * @description Thrown when request validation fails, so the failure reaches the
 * application's `ConfigService.onError` like every other error instead of being
 * answered inside the validator middleware.
 *
 * Extends Hono's `HTTPException` with status 400 deliberately: an existing handler
 * that branches on `error instanceof HTTPException` and replies with `error.status`
 * keeps answering 400, so adopting this does not silently turn validation failures
 * into 500s.
 *
 * @example
 * ```typescript
 * public onError(error: Error, context: Context) {
 *   if (isValidationError(error)) {
 *     return context.send({ success: false, errors: error.issues }, 400);
 *   }
 *
 *   if (error instanceof HTTPException) {
 *     return context.send({ error: error.message }, error.status);
 *   }
 *
 *   return context.send({ error: 'Internal Server Error' }, 500);
 * }
 * ```
 */
export class ValidationError extends HTTPException implements ValidationErrorLike {
  public readonly [VALIDATION_ERROR] = true as const;

  /** Which part of the request failed: `json`, `query`, `form`, `param` or `header` */
  public readonly target: string;

  /** Field-level failures, adapter-agnostic */
  public readonly issues: ValidationIssue[];

  /** The original Zod error, for anything `issues` does not carry */
  public readonly cause: ZodError;

  public constructor(cause: ZodError, target: string) {
    super(400, { message: 'Validation failed' });

    this.name = 'ValidationError';
    this.target = target;
    this.cause = cause;
    this.issues = cause.issues.map((issue) => ({
      path: issue.path.map((segment) => (typeof segment === 'symbol' ? segment.toString() : segment)),
      message: issue.message,
      code: issue.code,
    }));
  }
}
