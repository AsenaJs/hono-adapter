export * from './lib/HonoAdapter';
export * from './lib/HonoWebsocketAdapter';
export * from './lib/types';
export * from './lib/defaults';
export * from './lib/utils/createHonoAdapter';
export * from './lib/errors';

/**
 * Hono's own `HTTPException`, re-exported so applications and middlewares stay on the copy of
 * `hono` this adapter resolved - importing it from `hono/http-exception` directly is what lets a
 * project end up with two `HTTPException` classes that `instanceof` disagrees about.
 *
 * This is *not* the class to throw for an ordinary HTTP error. That is `HttpException` from
 * `@asenajs/asena/adapter`, which is the same class on every adapter, so the same `throw`
 * compiles and behaves identically on ergenecore and here. It is deliberately not re-exported
 * from this package: two throwable, branded classes whose names differ by the case of two letters
 * is a trap for autocomplete, and only one of them is the portable one.
 *
 * Both are recognised by `isHttpException()` and both are answered from their own status, so
 * anything hono's ecosystem raises - `hono/basic-auth`, `hono/bearer-auth`, `hono/jwt`, hono's
 * validator - keeps working exactly as before.
 */
export { HTTPException } from 'hono/http-exception';
