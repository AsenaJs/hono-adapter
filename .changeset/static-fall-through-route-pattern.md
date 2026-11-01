---
"@asenajs/hono-adapter": patch
---

`context.routePattern` now reports the endpoint that is handling the request. When a static route misses a file and Hono
passes the request on to a later endpoint (e.g. a `/*` fallback), that endpoint and any middleware reading the pattern
after `next()` see the fallback's pattern instead of the static route's (`/assets/:file`). A middleware reading it before
`next()` still sees the first endpoint ahead of it.
