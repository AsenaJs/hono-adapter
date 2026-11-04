import type { Context, Next } from 'hono';

// Hono's compose and hono-base hand only `instanceof Error` to `onError` and rethrow anything else
// out of `fetch`, so a thrown non-Error travels in this carrier and is unwrapped in `onError`.
class ThrownValue extends Error {
  public constructor(public readonly value: unknown) {
    super('A non-Error value was thrown');
  }
}

export const asError = (value: unknown): Error => (value instanceof Error ? value : new ThrownValue(value));

export const unwrapThrown = (error: Error): unknown => (error instanceof ThrownValue ? error.value : error);

// A circular or BigInt-carrying value must not make the error path itself throw.
export const describeThrown = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
};

const rethrowAsError = (value: unknown): never => {
  throw asError(value);
};

export const guardThrows = <H extends (context: Context, next: Next) => unknown>(handler: H): H =>
  ((context: Context, next: Next) => {
    try {
      const result = handler(context, next);

      return result instanceof Promise ? result.catch(rethrowAsError) : result;
    } catch (error) {
      throw asError(error);
    }
  }) as H;
