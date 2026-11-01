---
"@asenajs/hono-adapter": patch
---

A static route whose `onNotFound` hook is marked `@Override` now continues to the route's controller method when the
file is missing: the hook runs once and the handler answers, the same as on ergenecore. Previously the request always
fell through to the application's 404. Without `@Override` a missing file still answers the 404 and the handler is
never called. The overriding hook still receives the raw Hono context, as before.
