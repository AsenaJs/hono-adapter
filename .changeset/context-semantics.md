---
"@asenajs/hono-adapter": major
---

Breaking: `setResponseHeader` now **replaces** the header value (it appended before); use the new `appendResponseHeader` to append while keeping existing values, which is what multi-valued headers such as `Vary` and `Link` need. `getQuery` is now typed `string | undefined` — `undefined` when the parameter is absent, `''` when present but empty (the runtime already behaved this way). `writeSSE` accepts a `comment` field, emitted as `: <line>` lines that are invisible to `EventSource` clients — use it for keep-alive pings (`stream.writeSSE({ comment: 'ping' })`); a message with neither `data` nor `comment` throws.

`CorsMiddleware` now appends `Vary: Origin` through `appendResponseHeader` with an "already listed" guard, so an upstream `Vary: Accept-Encoding` survives instead of being clobbered, and `Origin` is never listed twice when the middleware runs more than once. A global and a route `RateLimiterMiddleware` on the same request no longer produce duplicated `X-RateLimit-*` headers: with replace semantics the innermost limiter's values win, each header appearing exactly once.

Requires `@asenajs/asena` `^0.11.0` as the peer dependency and Bun 1.4. Core 0.10.x is outside the peer range.
