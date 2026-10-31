---
'@asenajs/hono-adapter': patch
---

`getQuery()` returns the same result as `c.req.query()` when a percent- or plus-encoded key earlier in the query string decodes to the requested name.
