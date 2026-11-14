---
'@asenajs/hono-adapter': minor
---

The package is type-checked with `strict: true`. `registerRoute()` accepts `null` or an omitted `staticServe` / `validator`, which the adapter already treated as absent; that parameter type is now exported as `HonoRouteParams` (a new public export, hence `minor`). Neither change affects runtime behaviour.
