---
"@asenajs/hono-adapter": patch
---

A WebSocket handshake ran every global middleware twice: once from the top-level `app.use()` registration and once more from the WebSocket route's own chain. It now runs them once, like HTTP routes — a global rate limiter charges one token per handshake, a global logger writes one line.
