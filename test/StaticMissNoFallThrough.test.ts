import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'bun';
import type { NotFoundRequest } from '@asenajs/asena/adapter';
import type { Context as HonoAdapterContext } from '../lib/defaults';
import { createTestAdapter, registerRoute, startTestServer } from './utils/testHelpers';

describe('a static miss does not fall through to another endpoint', () => {
  const root = mkdtempSync(join(tmpdir(), 'asena-static-miss-'));

  writeFileSync(join(root, 'app.css'), 'body{}');

  let server: Server<any> | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function boot(options: { appNotFound?: boolean; staticNotFound?: boolean; override?: boolean } = {}) {
    const { adapter, logger } = createTestAdapter();
    const probe = {
      fallback: 0,
      staticHandler: 0,
      order: [] as string[],
      notFound: [] as (NotFoundRequest & { routePattern: string | undefined })[],
    };

    if (options.appNotFound) {
      adapter.onNotFound((context: HonoAdapterContext, request: NotFoundRequest) => {
        probe.order.push('app');
        probe.notFound.push({ ...request, routePattern: context.routePattern });

        return context.send({ notFound: true }, 404);
      });
    }

    await registerRoute(adapter, {
      path: '/assets/:file',
      handler: (ctx) => {
        probe.staticHandler++;

        return ctx.send({ handler: 'assets' });
      },
      staticServe: {
        root,
        rewriteRequestPath: (requestPath: string) => requestPath.replace('/assets', ''),
        ...(options.staticNotFound
          ? {
              onNotFound: {
                handler: async () => {
                  probe.order.push('static');
                },
                override: options.override === true,
              },
            }
          : {}),
      },
    });
    await registerRoute(adapter, {
      path: '/*',
      handler: (ctx) => {
        probe.fallback++;

        return ctx.send({ handler: 'fallback' });
      },
    });

    const started = await startTestServer(adapter);

    server = started.server;

    return { probe, logger, baseUrl: started.baseUrl };
  }

  it("answers a missing asset with the application's onNotFound, not the /* endpoint", async () => {
    const { probe, baseUrl } = await boot({ appNotFound: true });
    const response = await fetch(`${baseUrl}/assets/missing.css`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ notFound: true });
    expect(probe.fallback).toBe(0);
    expect(probe.staticHandler).toBe(0);
    expect(probe.notFound).toEqual([{ path: '/assets/missing.css', method: 'GET', routePattern: '/assets/:file' }]);
  });

  it('answers the default 404 with one not-found log when the application has no onNotFound', async () => {
    const { probe, logger, baseUrl } = await boot();
    const response = await fetch(`${baseUrl}/assets/missing.css`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not Found' });
    expect(probe.fallback).toBe(0);
    expect((logger.info as any).mock.calls.filter((call: unknown[]) => call[0] === 'Route not found:')).toEqual([
      ['Route not found:', { path: '/assets/missing.css', method: 'GET', status: 404 }],
    ]);
  });

  it("runs a non-override static onNotFound hook, then the application's onNotFound", async () => {
    const { probe, baseUrl } = await boot({ appNotFound: true, staticNotFound: true });
    const response = await fetch(`${baseUrl}/assets/missing.css`);

    expect(response.status).toBe(404);
    expect(probe.order).toEqual(['static', 'app']);
    expect(probe.fallback).toBe(0);
  });

  it('lets an @Override static onNotFound hook hand the miss to the static route handler, not /*', async () => {
    const { probe, baseUrl } = await boot({ appNotFound: true, staticNotFound: true, override: true });
    const response = await fetch(`${baseUrl}/assets/missing.css`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ handler: 'assets' });
    expect(probe.order).toEqual(['static']);
    expect(probe.staticHandler).toBe(1);
    expect(probe.fallback).toBe(0);
  });

  it('does not fall through for a HEAD request on a missing asset', async () => {
    const { probe, baseUrl } = await boot({ appNotFound: true });
    const response = await fetch(`${baseUrl}/assets/missing.css`, { method: 'HEAD' });

    expect(response.status).toBe(404);
    expect(probe.fallback).toBe(0);
    expect(probe.notFound).toHaveLength(1);
  });

  it('still serves an existing asset', async () => {
    const { probe, baseUrl } = await boot({ appNotFound: true });
    const response = await fetch(`${baseUrl}/assets/app.css`);
    const head = await fetch(`${baseUrl}/assets/app.css`, { method: 'HEAD' });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('body{}');
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(probe.fallback).toBe(0);
    expect(probe.notFound).toEqual([]);
  });

  it('still lets a request outside the static route reach the /* endpoint', async () => {
    const { probe, baseUrl } = await boot({ appNotFound: true });
    const response = await fetch(`${baseUrl}/dashboard/settings`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ handler: 'fallback' });
    expect(probe.fallback).toBe(1);
    expect(probe.notFound).toEqual([]);
  });
});
