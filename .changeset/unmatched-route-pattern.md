---
"@asenajs/hono-adapter": patch
---

`context.routePattern` is now `undefined` when no route matched the request. Previously a global middleware read its own
catch-all pattern (`/*`, or an include pattern such as `/api/*`) on an unmatched path, so consumers like OTel route labels
grouped every unknown path under it. On a matched request a global middleware now reads the declared route pattern
(e.g. `/users/:id`) both before and after `next()`, instead of `/*` before it.
