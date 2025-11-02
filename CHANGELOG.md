# @asenajs/hono-adapter

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
