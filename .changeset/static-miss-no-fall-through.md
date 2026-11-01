---
"@asenajs/hono-adapter": minor
---

A static route now owns its request. When the requested file does not exist, the request ends at the static route: the
static `onNotFound` hook runs (if any), then the application's `onNotFound` answers, or the default 404
`{"error":"Not Found"}` when there is none - as on ergenecore. Before, Hono's `serveStatic` passed the miss on with
`next()`, so another matching endpoint (for example a `@Get('/*')` catch-all) answered it. A request that is not under the
static route still reaches that endpoint, and an existing file is served as before.

Breaking for an application that relied on that fall-through: a missing file under a static route no longer reaches a
later `/*` handler. Migrate by marking the static serve's `onNotFound` with `@Override()`: the miss then continues to the
static route's own controller method, which can answer it (for an SPA, return `index.html`), or use `rewriteRequestPath`
as in the documented SPA example. This is a minor rather than a major because the documented static-serve contract already
says a non-override miss answers 404; the fall-through was an undocumented Hono-only difference.
