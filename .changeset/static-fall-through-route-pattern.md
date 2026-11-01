---
"@asenajs/hono-adapter": patch
---

`context.routePattern` now reports the endpoint that is handling the request: the first route endpoint at or after the
handler Hono is running, instead of the first one Hono matched. On a static miss the static route answers, so the
application's `onNotFound` and any middleware read the static route's pattern (e.g. `/assets/:file`), as on ergenecore.
