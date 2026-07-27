import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { ServerLogger } from '@asenajs/asena/logger';
import { HttpMethod } from '@asenajs/asena/web-types';
import { HonoAdapter } from '../lib/HonoAdapter';

const silentLogger = (): ServerLogger => ({
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  profile: mock(() => {}),
});

/**
 * Twin of `ergenecore/test/htmlRouteCollision.test.ts`, and the reason that file is a pair.
 *
 * Ergenecore threw on this from the start; this adapter let the page win. The two adapters
 * disagreed about whether an application was even legal to boot, and both suites were green,
 * because each package tests only itself and neither had a case for the interaction at all.
 * The asymmetry is structural rather than accidental: ergenecore merges HTML routes into the
 * same `routes` object it builds its API routes into, so a collision is a key clash it cannot
 * avoid noticing, while this adapter keeps API routes inside Hono's `fetch` and HTML routes in
 * `Bun.serve({ routes })` - two tables that never meet, so nothing was in a position to compare
 * them until something deliberately did.
 *
 * Bun checks `routes` before `fetch`, so on this adapter the page silently outranked the API
 * route: 200 with HTML, the JSON endpoint unreachable while still printed in the startup log.
 */
describe('HTML route collisions', () => {
  let server: { stop: (force?: boolean) => void; port: number } | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  const page = () => new Response('<html>page</html>', { headers: { 'Content-Type': 'text/html' } });

  const adapterWith = async (apiPath: string, pagePath: string) => {
    const adapter = new HonoAdapter(silentLogger());

    adapter.setPort(0);

    await adapter.registerRoute({
      method: HttpMethod.GET,
      path: apiPath,
      middlewares: [],
      handler: (context: any) => context.send({ from: 'api' }),
      staticServe: null,
      validator: null,
    } as any);

    adapter.registerHTMLRoute(pagePath, page(), 'DashboardController', '/');

    return adapter;
  };

  test('a page on the same path as an API route throws at boot', async () => {
    const adapter = await adapterWith('/dashboard', '/dashboard');

    await expect(adapter.start()).rejects.toThrow(/HTML route collision/);
  });

  test('the message names the path that collided', async () => {
    const adapter = await adapterWith('/dashboard', '/dashboard');

    await expect(adapter.start()).rejects.toThrow('/dashboard');
  });

  test('the trailing-slash variant collides too', async () => {
    const adapter = await adapterWith('/reports/', '/reports');

    await expect(adapter.start()).rejects.toThrow(/HTML route collision/);
  });

  test('a page on a free path boots, and both are reachable', async () => {
    const adapter = await adapterWith('/api/data', '/ui/dashboard');

    server = (await adapter.start()) as any;

    const api = await fetch(`http://localhost:${server!.port}/api/data`);

    expect(api.status).toBe(200);
    expect(await api.json()).toEqual({ from: 'api' });

    // Proves the shadowing mechanism is real and still in force for paths that do not collide -
    // the page is served by Bun ahead of Hono, which is why the collision has to be a boot
    // error rather than something the router could resolve.
    const ui = await fetch(`http://localhost:${server!.port}/ui/dashboard`);

    expect(ui.status).toBe(200);
    expect(await ui.text()).toContain('<html>');
  });

  test('a page colliding with a WebSocket path throws too', async () => {
    const adapter = new HonoAdapter(silentLogger());

    adapter.setPort(0);
    adapter.registerWebsocketRoute({
      path: 'live',
      middlewares: [],
      websocketService: null,
    } as any);
    // WebSocket paths are stored without a leading slash and HTML paths with one; comparing
    // them raw would miss every collision of this kind.
    adapter.registerHTMLRoute('/live', page(), 'LiveController', '/');

    await expect(adapter.start()).rejects.toThrow(/HTML route collision/);
  });

  test('a duplicate page path is still rejected at registration', async () => {
    const adapter = new HonoAdapter(silentLogger());

    adapter.registerHTMLRoute('/ui/home', page(), 'HomeController', '/');

    expect(() => adapter.registerHTMLRoute('/ui/home', page(), 'OtherController', '/')).toThrow(/Duplicate HTML route/);
  });
});
