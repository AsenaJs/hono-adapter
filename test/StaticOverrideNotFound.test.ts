import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { HttpMethod } from '@asenajs/asena/web-types';
import { HonoAdapter } from '../lib/HonoAdapter';
import type { Context } from '../lib/defaults/Context';
import { createMockLogger } from './utils/testHelpers';

describe('static onNotFound with override', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asena-static-override-'));

  fs.writeFileSync(path.join(root, 'hello.txt'), 'hello');

  let server: { stop: (force?: boolean) => void; port: number } | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function boot(override: boolean) {
    const adapter = new HonoAdapter({ logger: createMockLogger() });
    const probe = { notFound: [] as string[], handler: 0 };

    adapter.setPort(0);
    adapter.registerRoute({
      method: HttpMethod.GET,
      path: '/static/*',
      middlewares: [],
      handler: async (context: Context) => {
        probe.handler++;

        return context.send({ fellThrough: true });
      },
      staticServe: {
        root,
        rewriteRequestPath: (requestPath: string) => requestPath.replace('/static', ''),
        onNotFound: {
          handler: async (filePath: string) => {
            probe.notFound.push(filePath);
          },
          override,
        },
      },
      validator: null,
    } as any);

    server = (await adapter.start()) as any;

    return { probe, get: (target: string) => fetch(`http://localhost:${server!.port}${target}`) };
  }

  it('runs the hook once and lets the route handler answer a missing file', async () => {
    const { probe, get } = await boot(true);
    const response = await get('/static/missing.txt');

    expect(probe.notFound).toHaveLength(1);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ fellThrough: true });
    expect(probe.handler).toBe(1);
  });

  it('still serves a present file without reaching the handler', async () => {
    const { probe, get } = await boot(true);
    const response = await get('/static/hello.txt');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello');
    expect(probe.notFound).toEqual([]);
    expect(probe.handler).toBe(0);
  });

  it('without override a missing file answers 404 and the handler never runs', async () => {
    const { probe, get } = await boot(false);
    const response = await get('/static/missing.txt');

    expect(probe.notFound).toHaveLength(1);
    expect(response.status).toBe(404);
    expect(probe.handler).toBe(0);
  });
});
