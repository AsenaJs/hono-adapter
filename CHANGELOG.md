# @asenajs/hono-adapter

## 3.1.0

### Minor Changes

- 834322a: `getBody()` returns validated data; CORS sets `Vary: Origin` and stops answering 403

  Three independent fixes, all found in one production application.

  **`getBody()` now returns the validator's output.** `zValidator` parsed the body into
  `c.req.valid('json')` and nothing on `AsenaContext` ever read it — `getBody()` re-read the raw JSON
  with `c.req.json()`. Since `z.object()` strips unknown keys rather than rejecting them, a route
  could declare a strict schema, pass validation, and still hand the handler every extra key the
  client attached. The common shape

  ```ts
  await this.repository.updateById(id, await context.getBody());
  ```

  was therefore a mass-assignment sink on every validated route, with a schema sitting next to it
  that looked like it prevented exactly that. Two live instances existed in the application this was
  found in: a room settings endpoint where `ownerId` and a plaintext `password` were writable, and a
  moderation endpoint where a user could set `status` on their own request and self-approve.

  Routes without a validator are unaffected. Only the body is swapped — `query`, `param` and `header`
  schemas still validate but their coerced output is not written back, which is now stated in the
  documentation rather than left to be discovered.

  **`CorsMiddleware` sets `Vary: Origin`.** For any `origin` config other than the literal `'*'` the
  allowed-origin header is computed from the request's own `Origin`, and nothing said so. A CDN or
  shared proxy in front of the API could hand one origin's `Access-Control-Allow-Origin` to a request
  from a different origin. The header is set on both the actual response and the preflight 204, and
  also when the origin is refused, because that response varies by `Origin` too.

  **A disallowed origin is served without CORS headers instead of `403`.** CORS is a policy the
  browser enforces on the user's behalf; the denial the spec describes is a response the browser
  refuses to expose, not a server-side rejection. The 403 additionally turned away non-browser callers
  that merely send an `Origin` header, which forced applications to register the middleware
  conditionally when CORS was already terminated at the ingress. If you relied on the 403 as access
  control, it was never one — put the check in a middleware or guard of your own.

  **Preflight responses keep headers set upstream.** The 204 was built from a fresh headers object, so
  anything an earlier middleware wrote through `setResponseHeader` was dropped from preflights alone
  while surviving every other method.

  **The default `BunLocalTransport` is written back to the adapter's field.** It was assigned to a
  local variable, so sockets — which are built from the field — got `undefined` while
  `AsenaWebSocketServer` got the default, and the framework's two broadcast paths disagreed about the
  sender in the default configuration. The shutdown path reads the same field, so the default was also
  never torn down.

  This half pairs with `@asenajs/asena` 0.10.1, which adds `publishRemote()` and makes
  `socket.publish()` exclude the sender whatever transport is configured. **The peer range moves to
  `^0.10.1`.** Writing the default transport back to the field is what makes the older core reachable:
  on 0.10.0 `AsenaSocket.publish()` has no `publishRemote` branch, so a set transport sends it down
  `transport.publish()` → `server.publish()` and the sender receives its own message — in the default
  configuration, not just for applications that configured a transport. The range is the only thing
  that can rule that combination out, so the adapter no longer claims to support it. The startup
  warning naming `publishRemote` stays for transports that are simply older than the contract.

## 3.0.0

### Major Changes

- `hono` and `zod` are now peer dependencies

  The adapter's job is to offer a wrapper, not to supply the framework it wraps. Both libraries are
  part of the contract between this package and your application - `HTTPException` and `Context` come
  from hono, `ValidationService.json()` returns a zod schema, and all of them appear in the published
  `.d.ts` - so both must be the _same copy_ your application resolves. Declaring them as
  `dependencies` gave this package its own resolution slot, and that slot is a bug waiting for a
  lockfile to fill it.

  It did. A downstream application bumped `hono: ^4.12.9 -> ^4.12.32`, bun kept the adapter's
  already-satisfied copy nested under `@asenajs/hono-adapter/node_modules/hono`, and every deliberate
  400/403 thrown from `hono/http-exception` silently became a 500 while the API kept answering. 46/46
  of that app's tests stayed green. `brandHonoHttpException()` patches the prototype of the copy _this
  package_ resolved; a prototype patch cannot reach another copy's class. The split was not even
  semver-forced - `4.12.32` satisfied `^4.12.9` too. Only the extra resolution slot made it possible.

  ## Migration

  ```bash
  bun add hono zod
  rm -rf node_modules bun.lock && bun install
  ```

  The `rm -rf` is not optional when upgrading in place. A previous `bun install` has been observed to
  drop the nested copy from the lockfile while **leaving the directory on disk**, and two directories
  are two classes regardless of whether the versions match.

  | Package manager      | What you need to do                                                                                   |
  | :------------------- | :---------------------------------------------------------------------------------------------------- |
  | bun, npm 7+, pnpm 8+ | Peers auto-install, but declare them anyway - an undeclared peer disappears on the next clean install |
  | yarn 1               | **Required.** yarn 1 does not install peers, so without this the server fails at boot                 |

  ## Details
  - Requires **hono >= 4.12.9** and **zod ^4.3.6**. `flattenError` is a zod-v4 top-level export and is
    called at runtime, so zod 3 will not work.
  - `hono` is declared as a floor (`>=4.12.9`) rather than a caret, deliberately: a peer range that
    cannot be satisfied is the one remaining way to make npm or pnpm nest a second copy. A hono major
    mismatch instead shows up as a type error in your build, because this package's `.d.ts` references
    hono's types directly - which is loud, where a duplicate copy is silent.
  - `@hono/zod-validator` remains a regular dependency. You never import it, it declares no
    dependencies of its own, and its own hono/zod peers resolve to yours.
  - The adapter now writes a startup warning if it finds itself resolving a `hono` nested under
    `@asenajs/hono-adapter/node_modules/hono` - the one duplicate topology it can detect from the
    inside, and the one a stale directory leaves behind.
  - Nothing in the API changed.

### Minor Changes

- Answer `HttpException` from core, and derive the log level from the status the caller received

  Applications can now throw `HttpException` from `@asenajs/asena/adapter` - the same class, and the
  same throw, that works on `@asenajs/ergenecore`. Requires `@asenajs/asena` `>=0.9.2`; the peer
  range moves to `^0.9.2`.

  This package does **not** re-export it. It already exports hono's `HTTPException`, and two
  throwable, branded classes whose names differ by the case of two letters is a trap for
  autocomplete - only one of them is the portable one. Import `HttpException` from
  `@asenajs/asena/adapter` and `HTTPException` from here.

  **Hono's `HTTPException` is unaffected.** It is still exported, still branded, and still answered
  first - by `instanceof`, deliberately, so that it does not depend on the prototype patch having
  run. Everything `hono/basic-auth`, `hono/bearer-auth`, `hono/jwt` and hono's own validator throw
  keeps working exactly as before, and there are now end-to-end tests pinning that.

  Two fixes come with it:

  - **A branded exception from a second resolved copy answered 500.** `defaultErrorResponse` chose
    the response with `error instanceof HTTPException`, so anything branded but not an instance of
    _this_ copy of hono's class fell through to the generic 500 - which is precisely the failure the
    `HTTP_EXCEPTION` brand was introduced to prevent. It now checks the brand, and honours the
    status even when the exception carries no `getResponse()`. The body is withheld in that case:
    an exception the adapter does not recognise is not known to carry a message that is safe to
    send to the caller.

  - **The response and the log could disagree about the same request.** `logHandledError` derived
    its level by duck-typing a numeric `.status` off the error, independently of how the response
    was chosen. A plain `Error` carrying a stray `.status = 401` was answered 500 and logged at
    debug as a 4xx; a branded foreign exception was answered 500 and logged as whatever status it
    carried. Both now go through one `resolveErrorStatus`, so the logged status always equals the
    answered status - asserted as an invariant rather than a list of expected values, so the two
    cannot drift again.

## 2.0.0

### Major Changes

- Route middlewares no longer leak between sibling routes, plus a dedicated `onNotFound` hook

  ## Route middlewares were swapped between routes sharing a base path

  **This is a privilege-escalation class bug — upgrade if you use route-level `middlewares`.**

  The adapter hoisted "common" middlewares to a group-level `use('*')` and filtered them out of
  each individual route. Both steps compared middlewares with `mw.constructor.name`, but by the
  time a middleware reaches an adapter it is the plain `{ handle, override }` object
  `PrepareMiddlewareService` builds — so the name was `"Object"` for every one of them and the
  comparison was always true. Every route in a group ran the _first_ route's middlewares and had
  its own removed:

  ```typescript
  @Controller('/users')
  class UserController {
    @Get({ path: '/:id', middlewares: [ReadGuard] }) get(c) {}
    @Delete({ path: '/:id', middlewares: [AdminGuard] }) remove(c) {}
  }
  // DELETE /users/:id ran ReadGuard. AdminGuard never ran.
  ```

  It triggered whenever two or more routes shared a base path _and_ each carried at least one
  route-level middleware, and it was completely silent. The grouping optimisation is removed
  rather than repaired: measured over 100 routes it made no difference to throughput, and every
  route now registers with its own middlewares.

  ## Breaking: `onError` no longer sees unmatched routes

  They previously arrived as a synthetic error, so an application handler had to ask "was this
  actually an error?" on every call. Routing has its own hook now:

  ```typescript
  @Config()
  export class AppConfig extends ConfigService {
    public onNotFound(context: Context, request: NotFoundRequest) {
      return context.send({ title: 'Not Found', status: 404, instance: request.path }, 404);
    }
  }
  ```

  `NotFoundError` is removed. `request.path` and `request.method` match what ergenecore reports
  for the same request, so the same handler body works on either adapter.

  ## Breaking: a `@Page` path colliding with an API route now fails the boot

  HTML routes are handed to `Bun.serve({ routes })`, which Bun checks **before** falling through to
  Hono's `fetch` handler. A `@Page` registered on a path an HTTP route also serves therefore shadowed
  it silently: the request answered `200` with the page, the API route was unreachable, and it still
  appeared in the startup log as registered. The adapter now throws
  `HTML route collision at "<path>": path already registered as an API or WebSocket route.` — the
  same check, and the same message, `@asenajs/ergenecore` has always applied.

  ## Breaking: the default 404 is JSON, not `text/plain`

  Hono's built-in 404 answered `text/plain`, so the same application produced a different body
  depending on which adapter it ran under — the portability complaint that started this work. With
  no `onNotFound` declared the adapter now answers `{"error":"Not Found"}` with a 404, identical to
  ergenecore. The handler is registered unconditionally, so this holds even for an app with no
  config at all.

  ## Errors no longer flood the error log

  Errors were logged at `error` level with a full stack regardless of status, so ordinary
  validation and auth rejections filled the error stream. 5xx still logs at `error` with a stack;
  4xx logs at `debug` (falling back to `info` when the logger has none) without one. Pass
  `logErrors: false` to `createHonoAdapter` when your own handler already logs with a correlation
  id.

  ## Breaking: the framework's default log now fires exactly when its default response fires

  One rule, both adapters:

  |          | the hook answered | no hook, or it declined or threw                         |
  | -------- | ----------------- | -------------------------------------------------------- |
  | response | yours             | the framework's                                          |
  | log      | none              | 5xx `error` + stack · 4xx `debug` (→`info`) · 404 `info` |

  An `onError` that returns nothing, or throws, used to lose the original error entirely while the
  adapter answered its default — it is logged now. An `onError` that **does** answer no longer
  produces an adapter line: your handler owns the response, so it owns the record, with whatever
  correlation id you attach. There is no switch to force that line back on; `logErrors: false` only
  silences further.

  **An unmatched route is logged too**, at `info` — `Route not found:` with `{ path, method, status }`.
  It produced no output at any level before, which is the one class of traffic (bots, probes, a typo
  in a deployed client) an operator most needs to count. `info` rather than `warn` so a scanner
  walking `/wp-admin`, `/.env` and `/phpmyadmin` cannot fill the warning stream, and rather than
  `debug` because a 404 nobody can see is how a mistyped route survives to production. An
  application that declared `onNotFound` and answered from it gets no line, same rule.

  ## Breaking: one 500 body, matching ergenecore

  The adapter answered three different envelopes for the same failure: `text/plain` `Internal Server
Error` for an application with no config, `{"error":"Internal server error","message":"An unexpected
error occurred","timestamp":…}` when a handler declined or threw, and ergenecore answered a third.
  All of them are now `{"error":"Internal Server Error"}` with `Content-Type: application/json` —
  identical to `@asenajs/ergenecore`, the same portability decision already taken for the 404.

  ## Breaking: a validation failure travels one path, whoever answers it

  `handleValidationFailure` answered its own `{error, details, target}` 400 when the application had
  no `onError`, and threw a `ValidationError` otherwise. Returning a `Response` from inside the
  validator middleware means it never throws, so that 400 reached neither `onError` nor the log — the
  one 4xx an application could not see at any level. The branch is gone: the error is always thrown,
  and the envelope moved onto `ValidationError.getResponse()`, so the body no longer depends on
  whether an unrelated hook exists. An `onError` that declines used to get `HTTPException`'s bare
  `Validation failed` text and now gets the full envelope.

  **Breaking: an `onError` handler that returns nothing now falls back to the default 500.** The
  handler's return value was passed straight to Hono, which requires a `Response` — so returning
  `undefined`, the ordinary way to say _"not mine, use the default"_, made Bun answer **`200 OK`**
  with its `Welcome to Bun!` placeholder page. A failed request was reported to the client, and to
  every uptime monitor in front of it, as a success. `@asenajs/ergenecore` has always honoured that
  contract; this adapter now does too.

  **The fallback response no longer leaks the thrown message.** When the application's handler itself
  threw, the response body carried
  `process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : error.message` — and
  `error` there is the _original_ error, not the handler's failure. The gate was the wrong control:
  the leaking branch is the one `bun run`, `bun test` and every container that does not set the
  variable take, which made the unsafe path the default and the safe path the branch nobody exercised
  while developing. The generic string is now unconditional.

  **That logging now happens whether or not your application declares `onError`.** The handler was
  previously registered only when a config declared the hook, so an application with no `@Config` —
  or one declaring only `onNotFound` — answered a 500 and wrote nothing to the framework logger:
  Hono's built-in handler printed a bare stack to stderr with no path, method or status, `logErrors:
false` could not suppress it, and a 4xx produced no output at all.

  Hono's own `HTTPException` is now branded with `HTTP_EXCEPTION` when the adapter is
  constructed, so `isHttpException()` from `@asenajs/asena/adapter` recognises it. Without that,
  the documented `if (isHttpException(error)) … else 500` pattern answered **500 for every
  deliberate 401/403/404/429** on this adapter.

  ::: warning The brand does not cross two copies of `hono`
  It is installed on the `HTTPException.prototype` of the copy **this adapter** resolved, so an
  exception thrown from a second, separately-resolved copy of `hono` is not branded and
  `isHttpException()` answers `false` for it — exactly as `instanceof` would. Branding one
  prototype cannot reach another copy's class. The brand's job is to make `isHttpException()` work
  at all on this adapter in an ordinary single-copy install.

  `hono` is a regular **dependency** of this adapter, not a peer, so an application that also
  depends on `hono` directly can resolve a second copy — and that is the ordinary case, because
  `hono/http-exception` is where `HTTPException` is documented. **Import it from
  `@asenajs/hono-adapter` instead**, and you stay on the copy the adapter branded. Otherwise
  deduplicate `hono` in your lockfile.

  (`@asenajs/ergenecore` is unaffected: its `HttpException` carries the brand as an instance field
  under a registered symbol, which does survive across copies.)
  :::

  `ConfigService` declares its hooks (`onError`, `onNotFound`, `serveOptions`, `globalMiddlewares`,
  `transport`) through declaration merging. They stay optional, but an override with the wrong
  signature is now a compile error instead of a hook the framework silently never calls.

  Requires `@asenajs/asena` 0.9.0 or later.

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
