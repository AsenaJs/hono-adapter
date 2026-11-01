---
"@asenajs/hono-adapter": patch
---

`context.getBody()` resolves `{}` for an empty or whitespace-only request body (no body, `Content-Length: 0`, any or no
`Content-Type`, any method) instead of rejecting with `HttpException(400)`, matching ergenecore. A non-empty body that is
not valid JSON still rejects with `HttpException(400)`.
