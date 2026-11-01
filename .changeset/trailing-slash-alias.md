---
"@asenajs/hono-adapter": minor
---

API routes now answer the trailing-slash form of their path: with the default options `GET /users/` reaches the
`GET /users` route instead of returning 404, matching ergenecore. The `strict` option now defaults to `false`.

Behaviour change: an application that relied on `/x/` answering 404 gets the route's response instead. Pass
`strict: true` to `createHonoAdapter` / `new HonoAdapter` to keep the previous behaviour. An application that passes
its own Hono `app` keeps that app's `strict` setting. HTML routes and the root route `/` are unaffected.
