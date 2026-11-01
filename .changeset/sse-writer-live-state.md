---
"@asenajs/hono-adapter": patch
---

The `streamSSE` writer now reports `stream.aborted` and `stream.closed` live. Both were read once when the writer was
built, so they stayed `false` for the whole stream: a long-lived SSE loop that checked `stream.aborted` kept running
after the client disconnected, even though `onAbort` had fired. The `stream` and `streamText` writers already reported
live state and are unchanged.
