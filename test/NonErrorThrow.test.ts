import { afterEach, describe, expect, it } from 'bun:test';
import type { Server } from 'bun';
import { z } from 'zod';
import type { ServerLogger } from '@asenajs/asena/logger';
import type { BaseMiddleware } from '@asenajs/asena/adapter';
import { HttpMethod } from '@asenajs/asena/web-types';
import { HonoAdapter } from '../lib/HonoAdapter';
import type { Context } from '../lib/defaults';

/**
 * Hono's `compose` only calls `onError` for `err instanceof Error`, so a thrown string or plain
 * object escaped the adapter and Bun answered instead: no `@Catch()` catch-all, no
 * `ConfigService.onError`, no default envelope, no log line. The thrown value has to reach the
 * same path as an `Error`, unchanged, wherever in the request it was thrown - the contract
 * ergenecore already keeps.
 */
interface Entry {
  level: string;
  message: string;
  meta?: any;
}

const capturingLogger = () => {
  const entries: Entry[] = [];

  const logger: ServerLogger = {
    info: (message, meta) => entries.push({ level: 'info', message, meta }),
    warn: (message, meta) => entries.push({ level: 'warn', message, meta }),
    error: (message, meta) => entries.push({ level: 'error', message, meta }),
    profile: () => {},
    debug: (message, meta) => entries.push({ level: 'debug', message, meta }),
  };

  return { logger, entries };
};

type Site =
  | 'sync handler'
  | 'async handler'
  | 'route middleware'
  | 'override middleware'
  | 'global middleware'
  | 'validator schema'
  | 'validator hook';

const thrower = (value: unknown) => (): never => {
  throw value;
};

const register = async (adapter: HonoAdapter, site: Site, value: unknown) => {
  const raise = thrower(value);
  const middleware = (override = false): BaseMiddleware<Context> => ({ handle: async () => raise(), override }) as any;
  const passing = z.object({ name: z.string() });

  if (site === 'global middleware') adapter.use(middleware());

  await adapter.registerRoute({
    method: HttpMethod.POST,
    path: '/fail',
    middlewares:
      site === 'route middleware' ? [middleware()] : site === 'override middleware' ? [middleware(true)] : [],
    handler:
      site === 'sync handler'
        ? raise
        : site === 'async handler'
          ? async () => raise()
          : (context: Context) => context.send({ reached: true }),
    staticServe: null,
    validator:
      site === 'validator schema'
        ? { json: { handle: () => passing.refine(raise), override: false } }
        : site === 'validator hook'
          ? { json: { handle: () => ({ schema: passing, hook: raise }), override: false } }
          : null,
  } as any);
};

const sites: Site[] = [
  'sync handler',
  'async handler',
  'route middleware',
  'override middleware',
  'global middleware',
  'validator schema',
  'validator hook',
];

const values: [string, () => unknown][] = [
  ['a string', () => 'text'],
  ['a plain object', () => ({ code: 1 })],
];

describe('a thrown non-Error value', () => {
  let server: Server<any> | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  const request = () =>
    fetch(`http://localhost:${server!.port}/fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'a' }),
    });

  for (const site of sites) {
    for (const [label, make] of values) {
      describe(`${label} from a ${site}`, () => {
        it('reaches the application error handler unchanged', async () => {
          const { logger } = capturingLogger();
          const adapter = new HonoAdapter({ logger });
          const value = make();
          const received: unknown[] = [];

          adapter.setPort(0);
          adapter.onError(((error: unknown, context: Context) => {
            received.push(error);

            return context.send({ handled: true }, 418);
          }) as any);
          await register(adapter, site, value);
          server = await adapter.start();

          const response = await request();

          expect(response.status).toBe(418);
          expect(await response.json()).toEqual({ handled: true });
          expect(received).toHaveLength(1);
          expect(received[0]).toBe(value);
        });

        it('gets the default 500 and an error log line when the handler declines', async () => {
          const { logger, entries } = capturingLogger();
          const adapter = new HonoAdapter({ logger });
          const value = make();

          adapter.setPort(0);
          adapter.onError((() => undefined) as any);
          await register(adapter, site, value);
          server = await adapter.start();

          const response = await request();

          expect(response.status).toBe(500);
          expect(await response.json()).toEqual({ error: 'Internal Server Error' });

          const entry = entries.find((e) => e.message === 'Application error occurred:');

          expect(entry?.level).toBe('error');
          expect(entry?.meta).toEqual({ message: JSON.stringify(value), path: '/fail', method: 'POST', status: 500 });
        });

        it('gets the default 500 and an error log line with no application handler', async () => {
          const { logger, entries } = capturingLogger();
          const adapter = new HonoAdapter({ logger });
          const value = make();

          adapter.setPort(0);
          await register(adapter, site, value);
          server = await adapter.start();

          const response = await request();

          expect(response.status).toBe(500);
          expect(response.headers.get('content-type')).toContain('application/json');
          expect(await response.json()).toEqual({ error: 'Internal Server Error' });

          const entry = entries.find((e) => e.message === 'Application error occurred:');

          expect(entry?.level).toBe('error');
          expect(entry?.meta).toEqual({ message: JSON.stringify(value), path: '/fail', method: 'POST', status: 500 });
        });
      });
    }
  }

  it('logs a value JSON cannot serialise instead of failing inside the error path', async () => {
    const { logger, entries } = capturingLogger();
    const adapter = new HonoAdapter({ logger });
    const circular: Record<string, unknown> = {};
    const received: unknown[] = [];

    circular.self = circular;
    adapter.setPort(0);
    adapter.onError(((error: unknown) => {
      received.push(error);
    }) as any);
    await register(adapter, 'async handler', circular);
    server = await adapter.start();

    const response = await request();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal Server Error' });
    expect(received).toEqual([circular]);

    const entry = entries.find((e) => e.message === 'Application error occurred:');

    expect(entry?.meta.message).toBe('[object Object]');
  });
});
