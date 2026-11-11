---
'@asenajs/hono-adapter': minor
---

Under `asena console`, every HTTP request appears in the request inspector with its method, path, final status,
duration and the chain it went through, including the steps only the adapter sees: its own 404, its own error response
and legacy `validator:` schemas. A validation failure no `@Catch` or `onError` answered is credited to the validator
that failed, not to the adapter. The adapter records nothing unless the console attached to the process; otherwise the
server's `fetch` is `app.fetch` itself, which is always the case under `NODE_ENV=production`. While core has its
devtools bus disabled, an attached adapter passes each request straight to `app.fetch` and records no step, its own
404 and error response included. With several servers in one process, a request is reported as the server's that
answered it.
