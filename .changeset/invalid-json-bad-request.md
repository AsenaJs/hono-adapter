---
"@asenajs/hono-adapter": patch
---

`context.getBody()` now rejects with core `HttpException(400)` (`{ error: 'Invalid JSON in request body', message }`)
when the request body is not valid JSON. Previously the raw `SyntaxError` reached `onError` and, without one, the client
got a 500 for its own malformed request. An `onError` that matched `SyntaxError` now receives the `HttpException`
instead; `isHttpException(error)` and `error.status === 400` identify it, the same as on ergenecore.
