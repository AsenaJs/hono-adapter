import { expect, test } from 'bun:test';
import { z } from 'zod';
import { Context } from '../index';

class TypedContext extends Context.define({
  body: z.object({ count: z.coerce.number(), label: z.string().default('new') }),
  query: z.object({ page: z.coerce.number().default(1) }),
}) {}

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

async function checkTypes(context: TypedContext) {
  const body = await context.getBody();
  type _Body = Assert<Equal<typeof body, { count: number; label: string }>>;
  const page: number = context.input.query.page;
  const count: number = body.count;
  // @ts-expect-error Only declared targets are present.
  context.input.params;
  // @ts-expect-error Validated input is read-only.
  context.input.body = { count: 1, label: 'changed' };
  return { page, count };
}

function checkInvalidTarget() {
  // @ts-expect-error Unknown target names cannot enter a contract.
  class InvalidContext extends Context.define({ bogus: z.string() }) {}
  return InvalidContext;
}

test('Context.define is available as a runtime value', () => {
  expect(TypedContext).toBeFunction();
  expect(typeof checkTypes).toBe('function');
  expect(typeof checkInvalidTarget).toBe('function');
});
