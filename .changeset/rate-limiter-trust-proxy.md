---
"@asenajs/hono-adapter": major
---

**Breaking:** `RateLimiterMiddleware` identifies the client by the connecting peer address (`context.getRequestIp()`) instead of `X-Forwarded-For` / `CF-Connecting-IP`, which any client could set to get a fresh bucket per request. Behind a reverse proxy set the new `trustProxy` option (`true` for one proxy layer or a unix-socket listener, `string[]` of proxy addresses, or a predicate); the client is the rightmost `X-Forwarded-For` entry not written by a trusted proxy, so a forged left entry is never used. `CF-Connecting-IP` is no longer consulted (Cloudflare also appends to `X-Forwarded-For`; use a `keyGenerator` if you need it). Headers over 1024 characters are ignored. New `maxBuckets` (default 10000) bounds memory: the least recently seen client is evicted and starts with a full bucket.
