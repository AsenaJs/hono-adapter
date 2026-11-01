---
"@asenajs/hono-adapter": patch
---

A static route answers not-found for a request path whose decoded form carries a NUL byte (`/static/a%00.txt`) instead of
answering 500 and logging an application error, matching ergenecore.
