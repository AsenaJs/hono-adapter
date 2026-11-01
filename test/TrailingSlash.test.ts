import { afterEach, describe, expect, it } from 'bun:test';
import type { Server } from 'bun';
import { HonoAdapter } from '../lib/HonoAdapter';
import { createHonoAdapter } from '../lib/utils/createHonoAdapter';
import { createMockLogger, registerRoute } from './utils/testHelpers';

const page = () => new Response('<html>page</html>', { headers: { 'Content-Type': 'text/html' } });

async function boot(adapter: HonoAdapter) {
  adapter.setPort(0);

  await registerRoute(adapter, { path: '/x', handler: (ctx) => ctx.send({ route: 'x' }) });
  await registerRoute(adapter, { path: '/declared/', handler: (ctx) => ctx.send({ route: 'declared' }) });
  await registerRoute(adapter, { path: '/', handler: (ctx) => ctx.send({ route: 'root' }) });
  adapter.registerHTMLRoute('/page', page(), 'PageController', '/');

  const server = await adapter.start();

  return { server, baseUrl: `http://localhost:${server.port}` };
}

describe('Trailing slash alias', () => {
  let server: Server<any> | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  describe.each([
    ['createHonoAdapter(logger)', () => createHonoAdapter(createMockLogger())[0]],
    ['new HonoAdapter({ logger })', () => new HonoAdapter({ logger: createMockLogger() })],
  ])('with factory defaults (%s)', (_label, create) => {
    it('answers /x/ like /x on an API route', async () => {
      const booted = await boot(create());

      server = booted.server;

      const plain = await fetch(`${booted.baseUrl}/x`);
      const slashed = await fetch(`${booted.baseUrl}/x/`);

      expect(plain.status).toBe(200);
      expect(slashed.status).toBe(200);
      expect(await slashed.json()).toEqual(await plain.json());
    });

    it('answers both forms for a route declared with a trailing slash', async () => {
      const booted = await boot(create());

      server = booted.server;

      for (const path of ['/declared', '/declared/']) {
        const res = await fetch(`${booted.baseUrl}${path}`);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ route: 'declared' });
      }
    });

    it('leaves the root route and HTML routes unchanged', async () => {
      const booted = await boot(create());

      server = booted.server;

      const root = await fetch(`${booted.baseUrl}/`);

      expect(root.status).toBe(200);
      expect(await root.json()).toEqual({ route: 'root' });

      for (const path of ['/page', '/page/']) {
        const res = await fetch(`${booted.baseUrl}${path}`);

        expect(res.status).toBe(200);
        expect(await res.text()).toBe('<html>page</html>');
      }
    });

    it('still answers 404 for a path no route serves', async () => {
      const booted = await boot(create());

      server = booted.server;

      expect((await fetch(`${booted.baseUrl}/missing/`)).status).toBe(404);
    });
  });

  it('keeps /x/ a 404 when strict: true is passed explicitly', async () => {
    const booted = await boot(new HonoAdapter({ logger: createMockLogger(), strict: true }));

    server = booted.server;

    expect((await fetch(`${booted.baseUrl}/x`)).status).toBe(200);
    expect((await fetch(`${booted.baseUrl}/x/`)).status).toBe(404);
  });
});
