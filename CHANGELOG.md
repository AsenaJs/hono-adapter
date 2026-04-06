# @asenajs/hono-adapter

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
