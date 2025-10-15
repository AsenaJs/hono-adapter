# @asenajs/hono-adapter

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
