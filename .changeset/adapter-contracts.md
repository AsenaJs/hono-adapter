---
'@asenajs/hono-adapter': patch
---

`createHonoAdapter()` creates a console logger when it is given none - no argument, options without `logger`, or `logger: undefined` - and returns it as the second element of the tuple. Options passed without a `logger` are applied to the adapter instead of being taken for the logger.

A logger passed on its own (anything with an `info` method) is the logger the adapter uses and the one the factory returns, also when it has a `logger` field of its own: `createHonoAdapter(new AsenaLogger())` uses the `AsenaLogger` instead of the winston logger inside it.

`getParam()` returns `''` for a parameter the route does not declare and for an optional parameter (`/:id?`) the request leaves out.
