---
"@asenajs/hono-adapter": patch
---

A static route now decodes an escaped request path once before serving it. A malformed escape (`%zz`, a lone `%`, a
truncated UTF-8 sequence) rejects with core `HttpException(400)` (`{ error: 'Bad Request' }`) through the normal error
path, and a decoded path that leaves the static root (`..%2f...`) answers `403 Forbidden` with a warning log, the same
as on ergenecore. Previously both answered 404. Plain `../`, double-encoded and backslash spellings still answer 404,
and no file outside the root is served.
