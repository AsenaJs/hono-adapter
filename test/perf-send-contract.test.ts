import { afterEach, describe, expect, it } from 'bun:test';
import type { Server } from 'bun';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { HonoContextWrapper } from '../lib/HonoContextWrapper';
import { createTestAdapter, createTestMiddleware, registerRoute, startTestServer } from './utils/testHelpers';

function referenceSend(c: Context, data: any, statusOrOptions?: any): Response {
  const { headers = {}, status = 200 } =
    typeof statusOrOptions === 'number' ? { status: statusOrOptions } : statusOrOptions || {};

  Object.entries(headers).forEach(([key, value]) => {
    c.res.headers.append(key, value as string);
  });

  if (typeof data === 'string') {
    return c.text(data, status);
  }

  return c.json(data, status, headers);
}

const scenarios: Record<string, MiddlewareHandler | undefined> = {
  pristine: undefined,
  passThrough: async (_c, next) => {
    await next();
  },
  preparedHeader: async (c, next) => {
    c.header('X-Prepared', '1');
    await next();
  },
  preparedContentType: async (c, next) => {
    c.header('Content-Type', 'text/html');
    await next();
  },
  status404: async (c, next) => {
    c.status(404);
    await next();
  },
  status200: async (c, next) => {
    c.status(200);
    await next();
  },
  resTouched: async (c, next) => {
    c.res.headers.set('X-Res', '1');
    await next();
  },
  cookie: async (c, next) => {
    c.header('Set-Cookie', 'a=1', { append: true });
    c.header('Set-Cookie', 'b=2', { append: true });
    await next();
  },
  finalized: async (c, next) => {
    c.res = new Response('early', { headers: { 'X-Early': '1' } });
    await next();
  },
  afterNext: async (c, next) => {
    await next();
    c.header('X-After', String(c.res.headers.get('content-type')));
  },
};

const payloads: [string, any][] = [
  ['text', 'hello'],
  ['emptyText', ''],
  ['object', { a: 1, nested: { b: [1, 2] } }],
  ['array', [1, 'two']],
  ['null', null],
  ['undefined', undefined],
  ['number', 42],
  ['boolean', false],
];

const options: [string, any][] = [
  ['none', undefined],
  ['200', 200],
  ['201', 201],
  ['statusOnly200', { status: 200 }],
  ['statusOnly202', { status: 202 }],
  ['emptyHeaders', { headers: {} }],
  ['headers', { headers: { 'X-Custom': 'v' } }],
  ['headersAndStatus', { status: 203, headers: { 'X-Custom': 'v' } }],
];

async function snapshot(response: Response) {
  const headers: [string, string][] = [];

  response.headers.forEach((value, key) => {
    headers.push([key, value]);
  });

  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    cookies: response.headers.getSetCookie(),
    body: await response.text(),
  };
}

function buildApp(scenario: MiddlewareHandler | undefined, data: any, option: any, followUp: boolean) {
  const app = new Hono();

  if (scenario) {
    app.use('*', scenario);
  }

  app.get('/actual', (c) => {
    const response = new HonoContextWrapper(c).send(data, option);

    return followUp ? c.body('after') : response;
  });

  app.get('/reference', (c) => {
    const response = referenceSend(c, data, option);

    return followUp ? c.body('after') : response;
  });

  return app;
}

describe('send() response contract', () => {
  for (const [scenarioName, scenario] of Object.entries(scenarios)) {
    for (const [payloadName, data] of payloads) {
      for (const [optionName, option] of options) {
        it(`${scenarioName} / ${payloadName} / ${optionName} matches the reference`, async () => {
          for (const followUp of [false, true]) {
            const app = buildApp(scenario, data, option, followUp);

            for (const method of ['GET', 'HEAD']) {
              const actual = await snapshot(await app.request('/actual', { method }));
              const reference = await snapshot(await app.request('/reference', { method }));

              expect(actual).toEqual(reference);
            }
          }
        });
      }
    }
  }

  it('rethrows what JSON.stringify throws', async () => {
    const app = new Hono();
    let thrown: unknown;

    app.get('/', (c) => {
      try {
        new HonoContextWrapper(c).send({ big: 1n });
      } catch (error) {
        thrown = error;
      }

      return c.text('ok');
    });

    await app.request('/');

    expect(thrown).toBeInstanceOf(TypeError);
  });
});

describe('send() on the wire', () => {
  let server: Server<any> | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  async function rawGet(port: number, path: string): Promise<string> {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    let received = '';

    await Bun.connect({
      hostname: '127.0.0.1',
      port,
      socket: {
        open(socket) {
          socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
        },
        data(_socket, chunk) {
          received += chunk.toString();
        },
        close() {
          resolve(received);
        },
        error(_socket, error) {
          reject(error);
        },
      },
    });

    return promise;
  }

  function headerLines(raw: string): string[] {
    return raw
      .split('\r\n\r\n')[0]
      .split('\r\n')
      .filter((line) => !/^date:/i.test(line));
  }

  it('writes the same status line and headers as the reference calls', async () => {
    const { adapter } = createTestAdapter();
    const cases: [string, any, any][] = [
      ['text', 'hello', undefined],
      ['json', { a: 1 }, undefined],
      ['created', { a: 1 }, 201],
      ['custom', 'x', { headers: { 'X-Custom': 'v' } }],
    ];

    for (const [name, data, option] of cases) {
      await registerRoute(adapter, { path: `/actual/${name}`, handler: (ctx) => ctx.send(data, option) });
      await registerRoute(adapter, {
        path: `/reference/${name}`,
        handler: (ctx) => referenceSend((ctx as HonoContextWrapper).context, data, option),
      });
    }

    await registerRoute(adapter, {
      path: '/actual/guarded',
      middlewares: [createTestMiddleware('setHeader', { headerName: 'X-Guard', headerValue: 'yes' })],
      handler: (ctx) => ctx.send({ guarded: true }),
    });
    await registerRoute(adapter, {
      path: '/reference/guarded',
      middlewares: [createTestMiddleware('setHeader', { headerName: 'X-Guard', headerValue: 'yes' })],
      handler: (ctx) => referenceSend((ctx as HonoContextWrapper).context, { guarded: true }),
    });

    const started = await startTestServer(adapter);
    server = started.server;

    for (const name of [...cases.map(([caseName]) => caseName), 'guarded']) {
      const actual = await rawGet(started.port, `/actual/${name}`);
      const reference = await rawGet(started.port, `/reference/${name}`);

      expect(headerLines(actual)).toEqual(headerLines(reference));
      expect(actual.split('\r\n\r\n')[1]).toBe(reference.split('\r\n\r\n')[1]);
    }

    const text = await rawGet(started.port, '/actual/text');

    expect(text).toContain('HTTP/1.1 200 OK\r\n');
    expect(text.toLowerCase()).toContain('content-type: text/plain; charset=utf-8\r\n');
    expect(
      headerLines(text).some(
        (line) => line.toLowerCase().startsWith('content-type:') && line.endsWith(': text/plain; charset=UTF-8'),
      ),
    ).toBe(true);
  });
});
