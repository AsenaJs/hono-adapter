---
'@asenajs/hono-adapter': patch
---

A WebSocket route reached while the adapter has no server, such as after `start()` failed, is answered 404 like any request that cannot be upgraded, instead of failing with a `TypeError` and a 500.
