---
'@asenajs/hono-adapter': minor
---

`getParseBody()` now returns the schema's output when the route declares a `form` validator, matching what `getBody()` already does for `json`.

`zValidator` collapses repeated form keys into arrays and applies coercions, then stores the result in `c.req.valid('form')` - which nothing read. `parseBody()` without options is last-value-wins, so a handler behind a `z.object({ tags: z.array(z.string()), age: z.coerce.number() })` schema received `{ tags: 'b', age: '25' }` instead of the validated shape. Routes without a form validator keep the raw `parseBody()` semantics.
