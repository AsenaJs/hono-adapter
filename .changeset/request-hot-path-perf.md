---
"@asenajs/hono-adapter": patch
---

Faster request handling: static files are served through a Bun `serveStatic` wrapper that stats synchronously, request headers are read in one pass, and validated routes without a hook take fewer async steps.
