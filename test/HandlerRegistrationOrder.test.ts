import { afterEach, describe, expect, test } from 'bun:test';
import type { HonoAdapter } from '../lib/HonoAdapter';
import type { Context } from '../lib/defaults';
import { createTestAdapter, createTestMiddleware, registerRoute } from './utils/testHelpers';

// Core hands onError / onNotFound over ahead of use() and registerRoute(). Nothing in the adapter
// may depend on that: the handlers are looked up per request, whenever they were registered.
type Moment = 'before the middlewares and routes' | 'after the middlewares and routes' | 'after start()';

const moments: Moment[] = ['before the middlewares and routes', 'after the middlewares and routes', 'after start()'];

describe('onError / onNotFound registration order', () => {
  let adapter: HonoAdapter;
  let baseUrl: string;
  let ran: string[];

  const registerHandlers = () => {
    adapter.onError((error: Error, context: Context) => context.send({ handled: error.message }, 418));
    adapter.onNotFound((context: Context, request) => context.send({ missing: request.path }, 410));
  };

  const registerApp = async () => {
    adapter.use(
      createTestMiddleware(async (context, next) => {
        ran.push('global');

        if (context.req.path === '/global-boom') throw new Error('global');

        await next();
      }),
    );
    await registerRoute(adapter, {
      path: '/route-boom',
      middlewares: [
        createTestMiddleware(async () => {
          throw new Error('route');
        }),
      ],
    });
    await registerRoute(adapter, {
      path: '/handler-boom',
      handler: () => {
        throw new Error('handler');
      },
    });
  };

  const boot = async (moment: Moment) => {
    ({ adapter } = createTestAdapter());
    ran = [];

    if (moment === 'before the middlewares and routes') registerHandlers();

    await registerApp();

    if (moment === 'after the middlewares and routes') registerHandlers();

    const server = await adapter.start();

    if (moment === 'after start()') registerHandlers();

    baseUrl = `http://localhost:${server.port}`;
  };

  afterEach(async () => {
    await adapter?.stop();
  });

  for (const moment of moments) {
    describe(`registered ${moment}`, () => {
      for (const site of ['global', 'route', 'handler']) {
        test(`onError answers a throw from a ${site === 'handler' ? 'route handler' : `${site} middleware`}`, async () => {
          await boot(moment);

          const response = await fetch(`${baseUrl}/${site}-boom`);

          expect(response.status).toBe(418);
          expect(await response.json()).toEqual({ handled: site });
        });
      }

      test('onNotFound answers an unmatched route, after the global middleware', async () => {
        await boot(moment);

        const response = await fetch(`${baseUrl}/nowhere`);

        expect(response.status).toBe(410);
        expect(await response.json()).toEqual({ missing: '/nowhere' });
        expect(ran).toEqual(['global']);
      });
    });
  }

  test('with neither registered the adapter answers its own defaults', async () => {
    ({ adapter } = createTestAdapter());
    ran = [];
    await registerApp();

    const server = await adapter.start();

    baseUrl = `http://localhost:${server.port}`;

    const failed = await fetch(`${baseUrl}/handler-boom`);
    const missing = await fetch(`${baseUrl}/nowhere`);

    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'Internal Server Error' });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Not Found' });
  });
});
