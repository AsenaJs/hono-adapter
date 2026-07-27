import { describe, expect, mock, test } from 'bun:test';
import { HTTPException } from 'hono/http-exception';
import { isHttpException, HTTP_EXCEPTION } from '@asenajs/asena/adapter';
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
 * Byte-for-byte the same contract as `ergenecore/test/HttpExceptionBrand.test.ts`.
 *
 * The class users throw on this adapter is Hono's own `HTTPException`, which this package does
 * not own and therefore cannot declare the brand on. `brandHonoHttpException()` puts it on the
 * prototype from the adapter constructor. `hono` is a *peer* dependency, so two copies of it are
 * more likely here than two copies of the adapter - exactly the case the brand exists for.
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

  // The case the brand exists for: `hono` is a peer dependency, so a second resolved copy is
  // plausible and `error instanceof HTTPException` answers false for it. The predicate must
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
});
