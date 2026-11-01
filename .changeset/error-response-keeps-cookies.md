---
'@asenajs/hono-adapter': patch
---

Error responses keep the `Set-Cookie` headers set earlier in the request, matching `@asenajs/ergenecore`. A
middleware that re-issued a session cookie before a later `HttpException(403)` or an unhandled error no longer
loses it. When an application `onError` returns its own `Response`, the request's cookies are merged in, and the
response's own cookie wins over a request cookie with the same name, Domain and effective Path (an omitted Path
resolves to the request's default-path, as browsers do).
