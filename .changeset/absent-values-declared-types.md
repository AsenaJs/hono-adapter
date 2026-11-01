---
"@asenajs/hono-adapter": patch
---

`context.getQueryAll(name)` now resolves `[]` for a query key that is not in the URL, and `context.getCookie(name)`
resolves `false` for a missing cookie, signed or not - the types core declares (`string[]` and `string | false`).
Both resolved `undefined` before. A signed cookie with a bad signature still resolves `false`.
