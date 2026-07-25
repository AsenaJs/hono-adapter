---
'@asenajs/hono-adapter': minor
---

Support `AsenaStartOptions` in `HonoAdapter.start()`.

`start()` now accepts the optional start options Asena 0.8 passes through, and binds to a **unix domain socket** when `unix` is set instead of a TCP port. Bun rejects `hostname` and `unix` together, so both `hostname` and `port` are dropped from the serve config in that mode, and the startup log reports `unix:<path>` rather than an `http://localhost:<port>` URL that would not be reachable.

This is what makes `createTestApp({ dispatch: 'socket' })` from `@asenajs/asena/test` work: parallel test suites each get their own socket and can no longer collide on a random port.

The parameter is optional, so existing calls are unaffected.

Requires `@asenajs/asena` ≥ 0.8.0 (the `AsenaStartOptions` type).