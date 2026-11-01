---
'@asenajs/hono-adapter': patch
---

Error responses keep the `Set-Cookie` headers set earlier in the request. A middleware that re-issued a session
cookie before a later `HttpException(403)` or an unhandled error used to lose that cookie, because the error
response was built fresh; it now carries the cookies, matching `@asenajs/ergenecore`. A `Response` returned by an
application `onError` gets the same cookies merged in, without duplicating ones it already carries.
