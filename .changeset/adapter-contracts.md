---
'@asenajs/hono-adapter': patch
---

`createHonoAdapter()` creates a console logger when it is given none - no argument, options without `logger`, or `logger: undefined` - and returns it as the second element of the tuple. Options passed without a `logger` are applied to the adapter instead of being taken for the logger.

`createHonoAdapter()` and `new HonoAdapter()` tell a logger from options the same way: a logger passed on its own (anything with an `info` method) is the logger the adapter uses, also when it has a `logger` field of its own. `createHonoAdapter(new AsenaLogger())` and `new HonoAdapter(new AsenaLogger())` use the `AsenaLogger` instead of the winston logger inside it, and the factory returns it.

`getParam()` returns `''` for a parameter the route does not declare and for an optional parameter (`/:id?`) the request leaves out.
