import { afterEach, describe, expect, it } from 'bun:test';
import type { Server } from 'bun';
import { z } from 'zod';
import { HttpMethod } from '@asenajs/asena/web-types';
import { ValidationError } from '../lib/errors';
import { createTestAdapter, startTestServer } from './utils/testHelpers';

describe('validator without a hook', () => {
  let server: Server<any> | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  async function setup(
    target: 'json' | 'query' | 'header',
    schema: z.ZodType,
    onError?: (error: Error) => Response | undefined,
  ) {
    const { adapter } = createTestAdapter();

    if (onError) {
      adapter.onError((error) => onError(error));
    }

    await adapter.registerRoute({
      method: HttpMethod.POST,
      path: '/v',
      middlewares: [],
      handler: async (ctx: any) => ctx.send({ value: ctx.req.valid(target) }),
      staticServe: null,
      validator: { [target]: { handle: () => schema, override: false } },
    } as any);

    const { server: s, baseUrl } = await startTestServer(adapter);

    server = s;

    return baseUrl;
  }

  it('runs async refinements', async () => {
    const schema = z.object({ name: z.string() }).refine(async (v) => v.name !== 'taken', 'taken');
    let seen: Error | undefined;
    const baseUrl = await setup('json', schema, (error) => {
      seen = error;

      return new Response('rejected', { status: 409 });
    });
    const post = (name: string) =>
      fetch(`${baseUrl}/v`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

    const ok = await post('free');

    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ value: { name: 'free' } });

    const rejected = await post('taken');

    expect(rejected.status).toBe(409);
    expect(seen).toBeInstanceOf(ValidationError);
  });

  it('validates query values', async () => {
    const baseUrl = await setup('query', z.object({ page: z.coerce.number().int().min(1) }));

    const ok = await fetch(`${baseUrl}/v?page=3`, { method: 'POST' });

    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ value: { page: 3 } });

    const bad = await fetch(`${baseUrl}/v?page=0`, { method: 'POST' });

    expect(bad.status).toBe(400);
  });

  it('matches header schemas case-insensitively', async () => {
    const baseUrl = await setup('header', z.object({ 'X-Token': z.string().min(3) }));

    const ok = await fetch(`${baseUrl}/v`, { method: 'POST', headers: { 'x-token': 'abcd' } });

    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ value: { 'X-Token': 'abcd' } });

    const bad = await fetch(`${baseUrl}/v`, { method: 'POST', headers: { 'x-token': 'a' } });

    expect(bad.status).toBe(400);
  });
});
