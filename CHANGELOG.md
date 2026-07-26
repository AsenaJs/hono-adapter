# @asenajs/hono-adapter

## 1.7.0

### Minor Changes

- f4d0814: Validation failures now reach `ConfigService.onError`

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
  this does not turn validation failures into 500s. Check `isValidationError()` _before_ that
  branch if you want to reshape them.

  Applications that define no `onError` are unaffected: the previous
  `{ error, details, target }` envelope remains as the fallback.

  Also in this release:

  - A user-supplied `hook` no longer _replaces_ the default error handling. `hook || default`
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

## 1.6.0

### Minor Changes

- fbed9cc: Support `AsenaStartOptions` in `HonoAdapter.start()`.

  `start()` now accepts the optional start options Asena 0.8 passes through, and binds to a **unix domain socket** when `unix` is set instead of a TCP port. Bun rejects `hostname` and `unix` together, so both `hostname` and `port` are dropped from the serve config in that mode, and the startup log reports `unix:<path>` rather than an `http://localhost:<port>` URL that would not be reachable.

  This is what makes `createTestApp({ dispatch: 'socket' })` from `@asenajs/asena/test` work: parallel test suites each get their own socket and can no longer collide on a random port.

  The parameter is optional, so existing calls are unaffected.

  Requires `@asenajs/asena` ≥ 0.8.0 (the `AsenaStartOptions` type).

## 1.5.1

### Patch Changes

- ### Features
  - **FrontendController Logging**: FrontendController routes are now logged in the controller summary with route counts, grouped by controller name and base path.
  - **Route Pattern**: Added `routePattern` getter to `HonoContextWrapper` that returns Hono's `req.routePath`, enabling OpenTelemetry and middleware to access matched route patterns.

  ### Fixes
  - **WebSocket Trailing Slash**: Fixed WebSocket connection failures caused by trailing slashes in namespace paths. Both `HonoAdapter` and `HonoWebsocketAdapter` now normalize paths by stripping trailing slashes.
  - **Server Stop**: `stop()` method now properly awaits server shutdown.

  ### Tests
  - Added FrontendController summary logging tests.
  - Added WebSocket trailing slash normalization test.

## 1.5.0

### Minor Changes

- 310b53f: ### Test Overhaul
  - Complete rewrite of test suites for HonoAdapter, HonoContextWrapper, HonoWebsocketAdapter, CorsMiddleware, and RateLimiterMiddleware
  - New test suites: Streaming, GlobalMiddlewareCors, createHonoAdapter, routePriority
  - Shared test helpers (`testHelpers.ts`) for consistent mock creation across tests
  - Significantly improved test coverage and reliability

  ### New Features
  - **Streaming support**: `stream()`, `streamSSE()`, and `streamText()` methods on context wrapper
  - **Route priority sorting**: Automatic route ordering by specificity (static > param > wildcard) to prevent route conflicts
  - **HTML route registration**: `registerHTMLRoute()` for FrontendController page serving via `Bun.serve()`
  - **Options-based constructor**: New `HonoAdapterOptions` interface for cleaner adapter initialization (legacy constructor still supported)
  - **Request IP extraction**: `getRequestIp()` method using Bun's native `requestIP()`
  - **Global middleware top-level registration**: Ensures CORS handles all requests including OPTIONS preflight
  - **Configurable Hono strict mode**: `strict` option in adapter options
  - **Graceful shutdown**: `stop()` method on adapter

  ### Improvements
  - **WebSocket transport abstraction**: Configurable transport layer with `sendPingStrategy` (`'adapter'` | `'native'`) support
  - **Middleware abstraction**: CorsMiddleware now uses `setResponseHeader()` instead of direct Hono context access
  - **Response handling in middlewares**: Proper `false` → 403, Response → cloned and set on context
  - **Path normalization**: Trailing slash stripping for Hono compatibility
  - **Enhanced query handling**: `getAllQueries()` returns `Record<string, string | string[]>`
  - **Validation service**: Zod v4 compatibility with generic type support

  ### Dependency Updates
  - `@asenajs/asena` → `^0.7.0`
  - `hono` → `^4.12.9`
  - `zod` → `^4.3.6` (major version bump)
  - `@hono/zod-validator` → `0.7.6`

  ### Breaking Changes
  - Import paths updated to match Asena core reorganization (`@asenajs/asena/decorators`, `@asenajs/asena/decorators/http`)
  - Zod v4 may require schema adjustments in consumer projects

## 1.4.0

### Minor Changes

- chore(asena) asena version updated

### Patch Changes

- fix(middleware): middleware Response handling and ESLint v9 migration

  **Middleware Fixes:**
  - Replaced HTTPException with Response return in CorsMiddleware and RateLimiterMiddleware
  - Added Response handling support to middlewareParser
  - Aligned with Hono's middleware best practices
  - All middleware tests passing (44/44 tests pass)

  **ESLint v9 Migration:**
  - Migrated from ESLint v8 to v9 flat config system
  - Updated @typescript-eslint packages to 8.46.2
  - Added adapter-specific ignore rules (examples/**, benchmark/**)
  - Replaced @ts-ignore with @ts-expect-error directives
  - Fixed all lint errors (0 errors, 51 warnings)

## 1.3.0

### Minor Changes

- fix(lib): New AsenaWebSocketServer implemented

## 1.2.0

### Minor Changes

- 2d34650: Update compatibility with Asena 0.4.0 and Bun's new type system
  - Updated peer dependency to @asenajs/asena ^0.4.0
  - Fixed Server<WebSocketData> generic type requirements for Bun's latest version
  - Improved type safety for Bun.serve() options with proper ServeOptions typing
  - Added conditional port/unix socket handling for better type compatibility
  - All tests passing with full backward compatibility

## 1.1.0

### Minor Changes

- b647441: new AsenaWebsocketAdapter implementation implemented
