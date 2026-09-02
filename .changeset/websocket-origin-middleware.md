---
"@asenajs/hono-adapter": minor
---

Adds `WebSocketOriginMiddleware`: rejects a WebSocket handshake with 403 unless the `Origin` header is in `allowedOrigins` (list or predicate). Handshakes without an `Origin` are rejected too unless `allowMissingOrigin: true`. `CorsMiddleware` is not an origin policy — a disallowed origin still upgrades — so cookie-authenticated WebSockets need this middleware in front of their auth.
