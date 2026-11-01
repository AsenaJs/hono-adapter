import { afterEach, describe, expect, it } from 'bun:test';
import { HttpException, isHttpException } from '@asenajs/asena/adapter';
import { HttpMethod } from '@asenajs/asena/web-types';
import { HonoAdapter } from '../lib/HonoAdapter';
import { createMockLogger } from './utils/testHelpers';

describe('invalid JSON body', () => {
  let server: { stop: (force?: boolean) => void; port: number } | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  async function boot(withOnError: boolean) {
    const adapter = new HonoAdapter({ logger: createMockLogger() });
    const seen: { errors: unknown[]; handlerReturned: number } = { errors: [], handlerReturned: 0 };

    adapter.setPort(0);
    adapter.registerRoute({
      method: HttpMethod.POST,
      path: '/body',
      middlewares: [],
      handler: async (context) => {
        const body = await context.getBody();

        seen.handlerReturned++;

        return context.send({ body });
      },
      staticServe: null,
      validator: null,
    });

    if (withOnError) {
      adapter.onError((error, context) => {
        seen.errors.push(error);

        return isHttpException(error)
          ? context.send({ httpException: true, status: error.status }, error.status)
          : context.send({ httpException: false }, 500);
      });
    }

    server = (await adapter.start()) as any;

    const post = (body: string) =>
      fetch(`http://localhost:${server!.port}/body`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

    return { seen, post };
  }

  it('reaches onError as the core HttpException with status 400', async () => {
    const { seen, post } = await boot(true);
    const response = await post('{"a":');

    expect(seen.handlerReturned).toBe(0);
    expect(seen.errors).toHaveLength(1);
    expect(seen.errors[0]).toBeInstanceOf(HttpException);
    expect((seen.errors[0] as HttpException).status).toBe(400);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ httpException: true, status: 400 });
  });

  it('answers 400 without an onError', async () => {
    const { seen, post } = await boot(false);
    const response = await post('{"a":');

    expect(seen.handlerReturned).toBe(0);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON in request body', message: expect.any(String) });
  });

  it('still parses a valid body', async () => {
    const { post } = await boot(true);
    const response = await post('{"a":1}');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ body: { a: 1 } });
  });
});
