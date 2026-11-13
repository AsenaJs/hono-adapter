---
'@asenajs/hono-adapter': patch
---

The package is type-checked with `strict: true`. `registerRoute()` accepts `null` or an omitted `staticServe` / `validator`, which the adapter already treated as absent. No runtime behaviour changes.
