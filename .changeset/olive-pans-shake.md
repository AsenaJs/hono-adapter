---
'@asenajs/hono-adapter': minor
---

Validation failures now reach `ConfigService.onError`

A failed request validation was answered inside the validator middleware with a hardcoded
400 response. Because nothing was thrown, Hono's `app.onError` never fired and the handler
Asena wires from your `@Config` class never saw it - so a `ZodError` branch in an
`ExceptionMapper` was unreachable, and an application could not give validation errors the
same response envelope as the rest of its API. This contradicted both the validation and
the error-handling documentation.

The adapter now throws `ValidationError` (exported from `@asenajs/hono-adapter`), which
extends Hono's `HTTPException` with status **400** and carries `issues`, `target` and the
original `ZodError` as `cause`. Match it with `isValidationError()` from
`@asenajs/asena/adapter`.

Because it extends `HTTPException`, an existing handler that branches on
`instanceof HTTPException` and replies with `error.status` keeps answering 400 - adopting
this does not turn validation failures into 500s. Check `isValidationError()` *before* that
branch if you want to reshape them.

Applications that define no `onError` are unaffected: the previous
`{ error, details, target }` envelope remains as the fallback.

Also in this release:

- A user-supplied `hook` no longer *replaces* the default error handling. `hook || default`
  meant a hook added for logging or context enrichment silently changed that route's error
  contract to `@hono/zod-validator`'s raw output, so two routes in one application could
  answer the same class of error differently. The user hook now runs first and short-circuits
  only when it returns a `Response` (or `{ response }`), exactly as `zValidator` itself
  defines; otherwise the default handling continues.
- `@hono/zod-validator` upgraded from `^0.4.3` to `^0.9.0`. The old range predates Zod 4:
  its declared peer was `zod@^3.19.1` against the installed Zod 4, and its shipped types
  referenced `ZodTypeDef`, which no longer exists - masked only by `skipLibCheck`. This
  raises the `hono` requirement to `>=4.11.2`.
- Deprecated `ZodError.flatten()` replaced with `z.flattenError()`.
