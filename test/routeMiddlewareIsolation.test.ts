import { describe, expect, test, beforeAll, afterAll, mock } from 'bun:test';
import { HonoAdapter } from '../lib/HonoAdapter';
import { HttpMethod } from '@asenajs/asena/web-types';
import type { ServerLogger } from '@asenajs/asena/logger';
import type { Context } from '../lib/defaults/Context';

const mockLogger: ServerLogger = {
  profile: mock(() => {}),
  info: mock(() => {}),
  error: mock(() => {}),
  warn: mock(() => {}),
};

/**
 * Guards the fix for the route-grouping bug.
 *
 * HonoAdapter used to hoist "common" middlewares to a group-level `use('*')` and filter them
 * out of each individual route. Both steps compared middlewares with `mw.constructor.name` -
 * but a middleware arrives here as the plain `{ handle, override }` literal that
 * PrepareMiddlewareService builds, so every name was `"Object"` and every comparison was true.
 * Result: every route in a group ran the *first* route's middlewares and had its own removed.
 * Where those middlewares are authorisation guards, that is privilege escalation.
 *
 * It never fired in CI because the grouping branch needs >=2 routes on one base path with a
 * middleware on each, and no test or example app had that shape. It is the shape below.
 *
 * Do NOT add a route with `middlewares: []` to this group. `extractCommonMiddlewares` computed
 * an intersection, so one unguarded sibling emptied it, skipped the group branch and disarmed
 * the reproduction - the whole suite would then stay green under a revert.
 */
describe('Route middleware isolation', () => {
  // Random rather than a literal: a fixed port makes this suite depend on nothing else in the
  // repository having leaked a server on it.
  // 10000-31999: above the well-known range and below the kernel's ephemeral floor
  // (net.ipv4.ip_local_port_range, 32768-60999). Drawing a *server* port from the
  // ephemeral range collides with the outbound sockets the suite itself holds open -
  // including their 60s TIME_WAIT - and Bun.serve then fails with EADDRINUSE.
  const TEST_PORT = 10000 + Math.floor(Math.random() * 22000);

  let adapter: HonoAdapter;
  let calls: string[] = [];

  const tracking = (tag: string) => ({
    handle: async (_context: Context, next: () => Promise<void>): Promise<void> => {
      calls.push(tag);
      await next();
    },
    override: false,
  });

  beforeAll(async () => {
    adapter = new HonoAdapter(mockLogger);

    // /api/items/:id -> extractBasePath used to collapse these into one group
    adapter.registerRoute({
      method: HttpMethod.GET,
      path: '/api/items/:id',
      middlewares: [tracking('read-guard')],
      handler: async (ctx: Context) => ctx.send({ action: 'read' }),
    } as any);

    adapter.registerRoute({
      method: HttpMethod.DELETE,
      path: '/api/items/:id',
      middlewares: [tracking('admin-guard')],
      handler: async (ctx: Context) => ctx.send({ action: 'delete' }),
    } as any);

    adapter.registerRoute({
      method: HttpMethod.PUT,
      path: '/api/items/:id',
      middlewares: [tracking('write-guard')],
      handler: async (ctx: Context) => ctx.send({ action: 'update' }),
    } as any);

    adapter.setPort(TEST_PORT);
    await adapter.start();
  });

  afterAll(async () => {
    await adapter.stop();
  });

  test('DELETE runs its own guard, not the first route registered', async () => {
    calls = [];

    const response = await fetch(`http://localhost:${TEST_PORT}/api/items/42`, { method: 'DELETE' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ action: 'delete' });
    expect(calls).toEqual(['admin-guard']);
  });

  test('PUT runs its own guard', async () => {
    calls = [];

    const response = await fetch(`http://localhost:${TEST_PORT}/api/items/42`, { method: 'PUT' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ action: 'update' });
    expect(calls).toEqual(['write-guard']);
  });

  test('GET runs its own guard', async () => {
    calls = [];

    const response = await fetch(`http://localhost:${TEST_PORT}/api/items/42`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ action: 'read' });
    expect(calls).toEqual(['read-guard']);
  });

  test('no route ever runs a sibling guard', async () => {
    calls = [];

    await fetch(`http://localhost:${TEST_PORT}/api/items/1`);
    await fetch(`http://localhost:${TEST_PORT}/api/items/1`, { method: 'PUT' });
    await fetch(`http://localhost:${TEST_PORT}/api/items/1`, { method: 'DELETE' });

    // One guard per request, each the right one - never three read-guards.
    expect(calls).toEqual(['read-guard', 'write-guard', 'admin-guard']);
  });
});
