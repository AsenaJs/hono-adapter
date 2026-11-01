---
"@asenajs/hono-adapter": patch
---

`start()` now waits for the WebSocket transport's `init()` before it resolves. Previously it resolved while a remote
transport such as `RedisTransport` was still connecting, before every WebSocket service had its `server` assigned, and
a failing `init()` surfaced as an unhandled rejection. A failing `init()` now rejects `start()`, so the application
fails to boot instead of running without a working transport.
