---
'@asenajs/hono-adapter': patch
---

`setValue` now rejects a wrong value for a key declared on `AsenaVariables` (including the built-in `authSession`). The untyped fallback overload no longer matches known keys, matching the core `AsenaContext` contract.
