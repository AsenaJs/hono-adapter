---
'@asenajs/hono-adapter': patch
---

A value thrown that is not an `Error` (`throw 'text'`, `throw 42`, `throw { code: 1 }`) from a route handler, a
middleware or a validator reaches the application's error handling unchanged, as it does on ergenecore: the `@Catch()`
catch-all first, then `ConfigService.onError`. With no handler, or when every handler declines, the adapter answers its
default 500 JSON body and logs the value.

A route handler may return any thenable, not only a `Promise`: the request is answered with the `Response` it resolves
to, and a rejection takes the same error path as a throw.

Accept `@asenajs/asena` 0.13 as a peer.
