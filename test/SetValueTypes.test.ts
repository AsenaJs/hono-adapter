import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { HonoContextWrapper } from '../lib/HonoContextWrapper';

declare module '@asenajs/asena/adapter' {
  interface AsenaVariables {
    setValueUser: { id: string; name: string };
    setValueCount: number;
  }
}

async function withContext(fn: (ctx: HonoContextWrapper) => unknown): Promise<unknown> {
  const app = new Hono();

  app.get('/', (c) => c.json({ result: fn(new HonoContextWrapper(c)) ?? null }));

  const res = await app.request('/');

  return ((await res.json()) as { result: unknown }).result;
}

// The @ts-expect-error lines are the assertions: `bun run typecheck` fails if any of them compiles.
describe('setValue typing with augmented AsenaVariables', () => {
  it('accepts the declared type for an augmented key', async () => {
    const result = await withContext((ctx) => {
      ctx.setValue('setValueUser', { id: '1', name: 'Ada' });
      ctx.setValue('setValueCount', 42);

      return [ctx.getValue('setValueUser').name, ctx.getValue('setValueCount')];
    });

    expect(result).toEqual(['Ada', 42]);
  });

  it('rejects a wrong value for an augmented key', async () => {
    await withContext((ctx) => {
      // @ts-expect-error - number is not { id: string; name: string }
      ctx.setValue('setValueUser', 42);
      // @ts-expect-error - name is required
      ctx.setValue('setValueUser', { id: '1' });
      // @ts-expect-error - string is not number
      ctx.setValue('setValueCount', '42');
    });
  });

  it('rejects a wrong value for the built-in authSession key', async () => {
    await withContext((ctx) => {
      // @ts-expect-error - authSession is AuthSession | null | undefined
      ctx.setValue('authSession', 'token');
    });
  });

  it('still accepts any value for an undeclared key', async () => {
    const result = await withContext((ctx) => {
      ctx.setValue('anythingElse', { free: 'form' });

      return ctx.getValue<{ free: string }>('anythingElse').free;
    });

    expect(result).toBe('form');
  });
});
