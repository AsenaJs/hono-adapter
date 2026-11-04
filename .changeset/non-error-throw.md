---
'@asenajs/hono-adapter': patch
---

A value thrown that is not an `Error` (`throw 'text'`, `throw { code: 1 }`) from a route handler, a middleware or a
validator now reaches the application's error handler unchanged, as it does on ergenecore. Hono only hands `Error`
instances to `onError`, so such a value used to skip the `@Catch()` catch-all, `ConfigService.onError` and the adapter's
default response, and Bun reset the connection. With no handler, or one that declines, the adapter answers its default
500 JSON body and logs the value.

Accept `@asenajs/asena` 0.13 as a peer.
