---
"@asenajs/hono-adapter": patch
---

A static route now serves an in-root file whose request path carries an escape Hono's `serveStatic` refuses, such as an
encoded slash (`/static/sub%2Ffile.txt` serves `sub/file.txt`) or an encoded percent sign (`/static/100%25.txt` serves
`100%.txt`), instead of answering 404, matching ergenecore. The path is decoded once and `rewriteRequestPath` runs once on
the decoded path; `onFound` / `onNotFound` receive the joined file path. A malformed escape still answers 400 and a decoded
path outside the root still answers 403.
