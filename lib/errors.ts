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
 * Extends Hono's `HTTPException` with status 400 deliberately: a handler that matches
 * with `isHttpException()` - or with the older `error instanceof HTTPException` - and
 * replies with `error.status` keeps answering 400, so adopting this does not silently
 * turn validation failures into 500s.
 *
 * Note it does *not* extend `HttpException` from `@asenajs/asena/adapter`, the class
 * applications throw. Both are branded, so `isHttpException()` cannot tell them apart and
 * does not need to; `instanceof` can, which is one more reason not to reach for it.
 *
 * @example
 * ```typescript
 * public onError(error: Error, context: Context) {
 *   // Before isHttpException: ValidationError is an HTTP exception too, so the
 *   // generic branch below would otherwise swallow it.
 *   if (isValidationError(error)) {
 *     return context.send({ success: false, errors: error.issues }, 400);
 *   }
 *
 *   if (isHttpException(error)) {
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
 * deliberate 401/403/404/429 raised by `hono/basic-auth`, `hono/jwt` or hono's own validator
 * would take the else branch and answer 500.
 *
 * The brand covers one copy of `hono` and cannot reach another: it is installed on the prototype
 * of the class *this* package resolved. Since 3.0.0 `hono` is a **peer** dependency, so this
 * package has no resolution slot of its own and an application normally resolves exactly one copy
 * - which is what makes the brand sufficient rather than a trap. Before that it was a regular
 * dependency, and a downstream application that bumped its own `hono` range ended up with a second
 * nested copy whose `HTTPException` was unbranded: every deliberate 400/403 answered 500 while the
 * API kept responding. `warnOnNestedHono` below reports the one shape that can still produce it.
 *
 * Import `HTTPException` from `@asenajs/hono-adapter` rather than from `hono/http-exception` to
 * stay on this package's copy regardless. The adapter's default response also checks
 * `instanceof HTTPException` before the brand, so a hono exception is answered correctly even if
 * this function never ran.
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

/**
 * Warns when this package resolved a *nested* copy of `hono`.
 *
 * `hono` is a peer dependency, so it should always resolve from the application's own
 * `node_modules`. A path under `@asenajs/hono-adapter/node_modules/hono` means a second copy was
 * installed privately for this package - the exact topology that makes `brandHonoHttpException()`
 * useless, because the brand lands on the prototype of *this* copy's class and an `HTTPException`
 * the application threw from its own copy is neither `instanceof` it nor branded, so it is
 * answered 500.
 *
 * This does not - and cannot - detect the *application's* copy. `import.meta.resolve` always
 * answers relative to this module, Node resolution is per-importer so there is no single "the
 * application's hono" to compare against, and after `asena build` or `bun build --compile` there
 * is no `node_modules` to inspect at all. What it can prove is the asymmetric half: if *our* copy
 * is nested, there are two. That is enough, because under a peer dependency a nested copy is the
 * only way this package acquires one.
 *
 * Worth having even though the peer move makes the topology rare: `bun install` has been observed
 * to drop the lockfile entry for a nested copy while leaving the directory on disk, so an
 * application upgrading in place can still be broken by a leftover it cannot see.
 *
 * The path predicate is {@link isNestedHonoPath}, exported so it can be tested against both
 * layouts directly - inside this repo `import.meta.resolve` always answers
 * `hono-adapter/node_modules/hono`, which is the package's own root and deliberately does *not*
 * match, so a test driving the real resolver could only ever assert the negative case.
 */
export const isNestedHonoPath = (resolved: string): boolean =>
  resolved.includes('@asenajs/hono-adapter/node_modules/hono');

export const warnOnNestedHono = (logger?: { warn: (message: string) => void }): void => {
  try {
    const resolved = import.meta.resolve('hono/http-exception');

    if (!isNestedHonoPath(resolved)) {
      return;
    }

    (logger ?? console).warn(
      `A nested copy of \`hono\` was found at ${resolved}.\n` +
        `  \`hono\` is a peer dependency of @asenajs/hono-adapter and must resolve from your\n` +
        `  application's node_modules. With two copies, an HTTPException thrown from your copy is\n` +
        `  not recognised by isHttpException() and will be answered as 500.\n` +
        `  Fix: rm -rf node_modules bun.lock && bun install`,
    );
  } catch {
    // `import.meta.resolve` is unavailable or throws under some bundlers and in compiled binaries.
    // A diagnostic must never be the reason a server fails to boot.
  }
};
