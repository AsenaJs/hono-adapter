---
'@asenajs/hono-adapter': minor
---

`getBody()` returns validated data; CORS sets `Vary: Origin` and stops answering 403

Three independent fixes, all found in one production application.

**`getBody()` now returns the validator's output.** `zValidator` parsed the body into
`c.req.valid('json')` and nothing on `AsenaContext` ever read it — `getBody()` re-read the raw JSON
with `c.req.json()`. Since `z.object()` strips unknown keys rather than rejecting them, a route
could declare a strict schema, pass validation, and still hand the handler every extra key the
client attached. The common shape

```ts
await this.repository.updateById(id, await context.getBody());
```

was therefore a mass-assignment sink on every validated route, with a schema sitting next to it
that looked like it prevented exactly that. Two live instances existed in the application this was
found in: a room settings endpoint where `ownerId` and a plaintext `password` were writable, and a
moderation endpoint where a user could set `status` on their own request and self-approve.

Routes without a validator are unaffected. Only the body is swapped — `query`, `param` and `header`
schemas still validate but their coerced output is not written back, which is now stated in the
documentation rather than left to be discovered.

**`CorsMiddleware` sets `Vary: Origin`.** For any `origin` config other than the literal `'*'` the
allowed-origin header is computed from the request's own `Origin`, and nothing said so. A CDN or
shared proxy in front of the API could hand one origin's `Access-Control-Allow-Origin` to a request
from a different origin. The header is set on both the actual response and the preflight 204, and
also when the origin is refused, because that response varies by `Origin` too.

**A disallowed origin is served without CORS headers instead of `403`.** CORS is a policy the
browser enforces on the user's behalf; the denial the spec describes is a response the browser
refuses to expose, not a server-side rejection. The 403 additionally turned away non-browser callers
that merely send an `Origin` header, which forced applications to register the middleware
conditionally when CORS was already terminated at the ingress. If you relied on the 403 as access
control, it was never one — put the check in a middleware or guard of your own.

**Preflight responses keep headers set upstream.** The 204 was built from a fresh headers object, so
anything an earlier middleware wrote through `setResponseHeader` was dropped from preflights alone
while surviving every other method.

**The default `BunLocalTransport` is written back to the adapter's field.** It was assigned to a
local variable, so sockets — which are built from the field — got `undefined` while
`AsenaWebSocketServer` got the default, and the framework's two broadcast paths disagreed about the
sender in the default configuration. The shutdown path reads the same field, so the default was also
never torn down.

This half pairs with `@asenajs/asena` 0.10.1, which adds `publishRemote()` and makes
`socket.publish()` exclude the sender whatever transport is configured. The peer range stays
`^0.10.0`, so an application can still resolve core `0.10.0` here; on that combination
`socket.publish()` takes core's legacy branch (sender included) and this adapter logs one warning at
startup naming `publishRemote`. Upgrading core to 0.10.1 is the fix.
