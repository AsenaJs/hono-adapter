---
"@asenajs/hono-adapter": patch
---

The `streamSSE` error callback now owns the stream output: when the handler throws, the client receives only what the
callback writes. Previously Hono's helper appended its own `event: error` / `data: <message>` frame after the callback,
so a client saw one frame more than the application wrote - including the error message the application may have
chosen not to expose. Without an error callback nothing changes: the error is logged by Hono and the stream closes.
