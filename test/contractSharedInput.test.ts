import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HttpMethod } from '@asenajs/asena/web-types';
import { z } from 'zod';
import { Context, HonoAdapter } from '../index';

const logger = { info: () => {}, warn: () => {}, error: () => {}, profile: () => {} } as any;

describe('route context contracts share one request', () => {
  let adapter: HonoAdapter | undefined;

  afterEach(async () => {
    await adapter?.stop();
    adapter = undefined;
  });

  const start = async (setup: (adapter: HonoAdapter) => void) => {
    adapter = new HonoAdapter(logger);
    adapter.setPort(0);
    setup(adapter);

    const server = await adapter.start();

    return `http://localhost:${server.port}`;
  };

  it('a global middleware reads the validated body and input after next()', async () => {
    class CountContext extends Context.define({ body: z.object({ count: z.coerce.number() }) }) {}

    let seen: unknown;
    const baseUrl = await start((adapter) => {
      adapter.use({
        handle: async (context: any, next: () => Promise<void>) => {
          await next();
          seen = { body: await context.getBody(), input: context.input.body };
        },
      } as any);
      adapter.registerRoute({
        method: HttpMethod.POST,
        path: '/count',
        middlewares: [],
        contextClass: CountContext,
        handler: async (context: CountContext) => context.send(await context.getBody()),
      } as any);
    });

    const response = await fetch(`${baseUrl}/count`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ count: '2', admin: true }),
    });

    expect(await response.json()).toEqual({ count: 2 });
    expect(seen).toEqual({ body: { count: 2 }, input: { count: 2 } });
  });

  it('a form contract parses a body a middleware already read', async () => {
    class FormContext extends Context.define({ form: z.object({ name: z.string().min(1) }) }) {}

    const baseUrl = await start((adapter) => {
      adapter.registerRoute({
        method: HttpMethod.POST,
        path: '/form',
        middlewares: [
          {
            handle: async (context: any, next: () => Promise<void>) => {
              await context.getArrayBuffer();
              await next();
            },
          },
        ],
        contextClass: FormContext,
        handler: async (context: FormContext) => context.send(context.input.form),
      } as any);
    });

    const response = await fetch(`${baseUrl}/form`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'name=Alice',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: 'Alice' });
  });

  it('static onFound receives the route context with its validated input', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asena-contract-static-'));

    fs.writeFileSync(path.join(root, 'file.txt'), 'hello');

    class StaticContext extends Context.define({ query: z.object({ v: z.string() }) }) {}

    let seen: unknown;

    try {
      const baseUrl = await start((adapter) => {
        adapter.registerRoute({
          method: HttpMethod.GET,
          path: '/files/*',
          middlewares: [],
          contextClass: StaticContext,
          handler: async (context: Context) => context.send({ fellThrough: true }),
          staticServe: {
            root,
            extra: {},
            rewriteRequestPath: (requestPath: string) => requestPath.replace('/files', ''),
            onFound: {
              handler: (_path: string, context: any) => {
                seen = { subclass: context instanceof StaticContext, query: context.input.query };
              },
              override: false,
            },
          },
        } as any);
      });

      const response = await fetch(`${baseUrl}/files/file.txt?v=1`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('hello');
      expect(seen).toEqual({ subclass: true, query: { v: '1' } });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
