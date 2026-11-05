---
'@asenajs/hono-adapter': minor
---

Under `asena console`, every HTTP request appears in the request inspector with its method, path, final status,
duration and the chain it went through, including the steps only the adapter sees: its own 404, its own error response
and legacy `validator:` schemas. The adapter records nothing unless the console attached to the process; otherwise the
server's `fetch` is `app.fetch` itself.
