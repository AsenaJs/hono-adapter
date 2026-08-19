import { afterEach, describe, expect, it } from 'bun:test';
import type { Server } from 'bun';
import { z } from 'zod';
import { HttpMethod } from '@asenajs/asena/web-types';
import { createTestAdapter, startTestServer } from './utils/testHelpers';

/**
 * `getBody()` must hand the handler what the schema describes, not what the client sent.
 *
 * These encode a security property, not a convenience: `zValidator` parses into
 * `c.req.valid('json')`, and `getBody()` used to read `c.req.json()` instead - the raw body. A
 * route could therefore declare a strict schema, pass validation, and still hand
 * `updateById({ ...body })` every extra key the client attached, because `z.object()` strips
 * unknown keys rather than rejecting them. The schema looked like it prevented mass assignment
 * and prevented nothing.
 */
describe('getBody() returns validated data', () => {
  let server: Server<any> | undefined;

  afterEach(() => {
    if (server) {
      server.stop(true);
      server = undefined;
    }
  });

  /** Registers POST /body echoing whatever getBody() yields, optionally behind a json validator. */
  async function setup(schema?: z.ZodType) {
    const { adapter } = createTestAdapter();

    await adapter.registerRoute({
      method: HttpMethod.POST,
      path: '/body',
      middlewares: [],
      handler: async (ctx: any) => ctx.send({ body: await ctx.getBody() }),
      staticServe: null,
      validator: schema ? { json: { handle: () => schema, override: false } } : null,
    } as any);

    const { server: s, baseUrl } = await startTestServer(adapter);

    server = s;

    return baseUrl;
  }

  function post(baseUrl: string, body: unknown) {
    return fetch(`${baseUrl}/body`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('strips keys the schema does not declare', async () => {
    const baseUrl = await setup(z.object({ voteLock: z.boolean() }));

    const res = await post(baseUrl, {
      voteLock: true,
      ownerId: 'attacker-id',
      password: 'plaintext',
    });

    expect(res.status).toBe(200);

    const { body } = await res.json();

    // The two extra keys are the mass-assignment payload. Reaching the handler at all is the bug.
    expect(body).toEqual({ voteLock: true });
    expect(body.ownerId).toBeUndefined();
    expect(body.password).toBeUndefined();
  });

  it('applies schema defaults', async () => {
    const baseUrl = await setup(
      z.object({
        name: z.string(),
        role: z.string().default('member'),
      }),
    );

    const res = await post(baseUrl, { name: 'Alice' });

    expect((await res.json()).body).toEqual({ name: 'Alice', role: 'member' });
  });

  it('applies schema coercions', async () => {
    const baseUrl = await setup(z.object({ count: z.coerce.number() }));

    const res = await post(baseUrl, { count: '42' });

    const { body } = await res.json();

    expect(body.count).toBe(42);
    expect(typeof body.count).toBe('number');
  });

  it('does not fall back to the raw body when the schema output is null', async () => {
    // `??` would hand the raw body back to exactly the schemas that narrowed hardest.
    const baseUrl = await setup(z.null());

    const res = await post(baseUrl, null);

    expect((await res.json()).body).toBeNull();
  });

  it('leaves routes without a validator on the raw body', async () => {
    const baseUrl = await setup();

    const res = await post(baseUrl, { anything: 'goes', nested: { deep: 1 } });

    expect((await res.json()).body).toEqual({ anything: 'goes', nested: { deep: 1 } });
  });

  it('hands the handler the validated form output through getParseBody', async () => {
    // The same property, one representation over. Hono's form validator collapses repeated keys
    // into arrays and applies coercions, then stores the result in `c.req.valid('form')` - which
    // nothing read. `parseBody()` without options is last-value-wins, so the handler saw
    // `{ tags: 'b', age: '25' }` behind a schema that had already produced `{ tags: [...], age: 25 }`.
    const { adapter } = createTestAdapter();

    await adapter.registerRoute({
      method: HttpMethod.POST,
      path: '/form',
      middlewares: [],
      handler: async (ctx: any) => ctx.send({ body: await ctx.getParseBody() }),
      staticServe: null,
      validator: {
        form: {
          handle: () => z.object({ tags: z.array(z.string()), age: z.coerce.number() }),
          override: false,
        },
      },
    } as any);

    const { server: s, baseUrl } = await startTestServer(adapter);

    server = s;

    const formData = new FormData();

    formData.append('tags', 'a');
    formData.append('tags', 'b');
    formData.append('age', '25');
    formData.append('drop', 'unknown');

    const res = await fetch(`${baseUrl}/form`, { method: 'POST', body: formData });

    const { body } = await res.json();

    expect(body).toEqual({ tags: ['a', 'b'], age: 25 });
    expect(body.drop).toBeUndefined();
  });

  it('leaves form routes without a validator on the raw parsed body', async () => {
    // The raw shape is last-value-wins and stays that way: only a validator's output replaces it.
    const { adapter } = createTestAdapter();

    await adapter.registerRoute({
      method: HttpMethod.POST,
      path: '/form-raw',
      middlewares: [],
      handler: async (ctx: any) => ctx.send({ body: await ctx.getParseBody() }),
      staticServe: null,
      validator: null,
    } as any);

    const { server: s, baseUrl } = await startTestServer(adapter);

    server = s;

    const formData = new FormData();

    formData.append('tags', 'a');
    formData.append('tags', 'b');

    const res = await fetch(`${baseUrl}/form-raw`, { method: 'POST', body: formData });

    expect((await res.json()).body).toEqual({ tags: 'b' });
  });

  it('returns the same validated body on repeated calls', async () => {
    const { adapter } = createTestAdapter();

    await adapter.registerRoute({
      method: HttpMethod.POST,
      path: '/twice',
      middlewares: [],
      handler: async (ctx: any) => {
        const first = await ctx.getBody();
        const second = await ctx.getBody();

        return ctx.send({ first, second });
      },
      staticServe: null,
      validator: { json: { handle: () => z.object({ keep: z.string() }), override: false } },
    } as any);

    const { server: s, baseUrl } = await startTestServer(adapter);

    server = s;

    const res = await fetch(`${baseUrl}/twice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keep: 'yes', drop: 'no' }),
    });

    const { first, second } = await res.json();

    expect(first).toEqual({ keep: 'yes' });
    expect(second).toEqual({ keep: 'yes' });
  });
});
