---
'@asenajs/hono-adapter': patch
---

`createHonoAdapter()` creates a console logger when it is given none - no argument, options without `logger`, or `logger: undefined` - and returns it as the second element of the tuple. Options passed without a `logger` are applied to the adapter instead of being taken for the logger.
