import { HTTPException } from 'hono/http-exception';
import {
  HTTP_EXCEPTION,
  type HttpExceptionLike,
  VALIDATION_ERROR,
  type ValidationErrorLike,
  type ValidationIssue,
} from '@asenajs/asena/adapter';
import { flattenError, type ZodError } from 'zod';

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
export class ValidationError extends HTTPException implements ValidationErrorLike, HttpExceptionLike {
  public readonly [VALIDATION_ERROR] = true as const;

  /**
   * Also branded as an HTTP exception. Inherited from `HTTPException` in practice - see
   * `brandHonoHttpException` below - but declared here too so the type states it.
   */
  public readonly [HTTP_EXCEPTION] = true as const;

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

  /**
   * The envelope the caller sees when the application does not answer this failure itself.
   *
   * It lives here rather than in the adapter so a validation failure has exactly one response
   * shape - the adapter used to build a richer body inline for applications with no `onError`
   * and fall back to `HTTPException`'s bare `Validation failed` text for everyone else, so the
   * same failure answered two different bodies depending on an unrelated hook.
   *
   * Built on each call rather than passed to `super` as `res`: a `Response` body can only be
   * read once, and Hono may ask for this more than one time.
   */
  public override getResponse(): Response {
    return new Response(
      JSON.stringify({
        error: 'Validation failed',
        details: flattenError(this.cause),
        target: this.target,
      }),
      {
        status: this.status,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}

/**
 * Brands Hono's own `HTTPException` so `isHttpException()` recognises it.
 *
 * `HTTPException` comes from `hono/http-exception`, so this package cannot declare the brand on
 * the class - but it can put it on the prototype, which is the same thing at runtime and covers
 * every instance including ones the application constructs itself.
 *
 * Without this the brand is a trap rather than a feature: the JSDoc on `isHttpException` tells
 * users to write `if (isHttpException(error)) ... else 500`, and on this adapter every
 * deliberate 401/403/404/429 would take the else branch and answer 500. `hono` is a *peer*
 * dependency, so two copies of it are more likely here than two copies of the adapter - which
 * is the situation the brand exists for in the first place.
 *
 * Idempotent, and called from the HonoAdapter constructor.
 */
export const brandHonoHttpException = (): void => {
  if (Object.prototype.hasOwnProperty.call(HTTPException.prototype, HTTP_EXCEPTION)) {
    return;
  }

  Object.defineProperty(HTTPException.prototype, HTTP_EXCEPTION, {
    value: true,
    enumerable: false,
    configurable: true,
  });
};
