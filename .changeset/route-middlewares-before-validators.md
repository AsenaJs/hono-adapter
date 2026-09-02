---
"@asenajs/hono-adapter": minor
---

Route-level middlewares now run before the route's validator, so an auth or rate-limit middleware sees every request and an unauthenticated request never reaches validation. Global middlewares are unchanged. If a route middleware relied on the body having been validated first, it must validate itself now.

The peer range for `@asenajs/asena` is widened to `^0.11.0 || ^0.12.0` so the adapter can be used with core 0.12.0, which ships the auth contract this ordering aligns with.
