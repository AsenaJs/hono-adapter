import { describe, expect, mock, test } from 'bun:test';
import { HTTPException } from 'hono/http-exception';
import { isHttpException, HTTP_EXCEPTION, HttpException } from '@asenajs/asena/adapter';
import { HonoAdapter } from '../lib/HonoAdapter';
import { ValidationError } from '../lib/errors';
import type { ServerLogger } from '@asenajs/asena/logger';

const mockLogger: ServerLogger = {
  profile: mock(() => {}),
  info: mock(() => {}),
  error: mock(() => {}),
  warn: mock(() => {}),
};

/**
 * The same contract as `ergenecore/test/HttpExceptionBrand.test.ts`, plus the cases that only
 * exist here.
 *
 * Applications throw `HttpException` from `@asenajs/asena/adapter`. Hono's ecosystem throws
 * `HTTPException`, a class this package does not own and therefore cannot declare the brand on -
 * `brandHonoHttpException()` puts it on the prototype from the adapter constructor. `hono` is a
 * regular dependency here, but applications routinely depend on it directly as well, so a second
 * resolved copy is ordinary rather than exotic - exactly the case the brand exists for.
 */
describe('HttpException brand (hono)', () => {
  test("Hono's own HTTPException is branded once the adapter is constructed", () => {
    // eslint-disable-next-line no-new
    new HonoAdapter(mockLogger);

    expect(isHttpException(new HTTPException(401, { message: 'Unauthorized' }))).toBe(true);
  });

  // The brand has to land on the *prototype*. Asserting it only through an instance cannot
  // tell "brandHonoHttpException() ran" apart from "some class declares an own field", which
  // is what made the ValidationError test below pass with the branding deleted entirely.
  test('the brand lands on HTTPException.prototype, not on an instance', () => {
    // eslint-disable-next-line no-new
    new HonoAdapter(mockLogger);

    expect(Object.hasOwn(HTTPException.prototype, HTTP_EXCEPTION)).toBe(true);
    expect(Object.hasOwn(new HTTPException(401, { message: 'Unauthorized' }), HTTP_EXCEPTION)).toBe(false);
  });

  test('ValidationError is branded', () => {
    // eslint-disable-next-line no-new
    new HonoAdapter(mockLogger);

    expect(isHttpException(new ValidationError({ issues: [] } as any, 'json'))).toBe(true);
  });

  // The case the brand exists for: an application depending on `hono` directly can resolve a
  // second copy, and `error instanceof HTTPException` answers false for it. The predicate must
  // still recognise it, or the documented `if (isHttpException(error)) … else 500` pattern
  // turns every deliberate 401/403/404 into a generic 500.
  test('recognises an HTTPException from a second copy of hono', () => {
    // eslint-disable-next-line no-new
    new HonoAdapter(mockLogger);

    // Structurally what a foreign copy produces: same shape, different constructor.
    const foreign: unknown = Object.assign(Object.create(Object.getPrototypeOf(new Error())), {
      [HTTP_EXCEPTION]: true,
      status: 401,
      message: 'Unauthorized',
    });

    expect(foreign instanceof HTTPException).toBe(false);
    expect(isHttpException(foreign)).toBe(true);
    expect(isHttpException(foreign) && foreign.status).toBe(401);
  });

  test('status is readable through the branded shape', () => {
    // eslint-disable-next-line no-new
    new HonoAdapter(mockLogger);

    const error: unknown = new HTTPException(403, { message: 'Forbidden' });

    expect(isHttpException(error) && error.status).toBe(403);
  });

  test('a plain Error is not branded', () => {
    expect(isHttpException(new Error('nope'))).toBe(false);
    expect(isHttpException(null)).toBe(false);
    expect(isHttpException({ [HTTP_EXCEPTION]: false })).toBe(false);
  });

  // Two throwable, branded classes now reach an application running on this adapter: the portable
  // one from `@asenajs/asena/adapter`, and hono's own, which its ecosystem middlewares throw.
  // `isHttpException` covers both and is the reason an application does not have to care which it
  // is holding. `instanceof` does care, and these are the assertions that say so out loud.
  describe("the core class and hono's are both branded, and are not each other", () => {
    test('the core class is branded', () => {
      // eslint-disable-next-line no-new
      new HonoAdapter(mockLogger);

      expect(isHttpException(new HttpException(401, 'Unauthorized'))).toBe(true);
    });

    test("the core class is not hono's HTTPException", () => {
      expect(new HttpException(401, 'Unauthorized') instanceof HTTPException).toBe(false);
    });

    test("ValidationError extends hono's, not the core class", () => {
      // Deliberate: an existing handler branching on `instanceof HTTPException` keeps answering
      // 400 for a validation failure. It is also why `instanceof` is the wrong tool here - the
      // two branded classes sort differently under it and identically under the guard.
      const error = new ValidationError({ issues: [] } as any, 'json');

      expect(error instanceof HTTPException).toBe(true);
      expect(error instanceof HttpException).toBe(false);
      expect(isHttpException(error)).toBe(true);
    });

    test('this package does not export the core class under a confusable name', async () => {
      const exports = await import('../index');

      // `HttpException` and `HTTPException` differ by the case of two letters. Only hono's is
      // exported from here; the portable one comes from `@asenajs/asena/adapter`, so autocomplete
      // in a hono project cannot silently offer the wrong one.
      expect('HTTPException' in exports).toBe(true);
      expect('HttpException' in exports).toBe(false);
    });
  });
});
