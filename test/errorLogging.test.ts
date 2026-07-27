import { afterEach, describe, expect, it } from 'bun:test';
import type { ServerLogger } from '@asenajs/asena/logger';
import { HttpMethod } from '@asenajs/asena/web-types';
import { HTTPException } from 'hono/http-exception';
import { HonoAdapter } from '../lib/HonoAdapter';

/**
 * Mirrors `ergenecore/test/errorLogging.test.ts`. The two adapters must agree on what a failure
 * looks like in the logs, not only on what it looks like on the wire.
 *
 * The rule these tests pin: **the framework's default log fires exactly when the framework's
 * default response fires.** An application that answered from its own hook already knows about
 * the request and gets no line from here; an application that declared no hook, or whose hook
 * declined or threw, would otherwise have no record of the request at all.
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

interface BuildOptions {
  logErrors?: boolean;
  /** How the application's `onError` behaves, or that it declared none */
  onError?: 'none' | 'answers' | 'declines' | 'throws';
  /** How the application's `onNotFound` behaves, or that it declared none */
  onNotFound?: 'none' | 'answers' | 'throws';
}

const buildAdapter = (logger: ServerLogger, options: BuildOptions = {}) => {
  const { logErrors, onError = 'none', onNotFound = 'none' } = options;

  const adapter = new HonoAdapter(logErrors === undefined ? { logger } : { logger, logErrors });

  adapter.setPort(0);
  adapter.registerRoute({
    method: HttpMethod.GET,
    path: '/boom',
    middlewares: [],
    handler: () => {
      throw new Error('kaboom');
    },
    staticServe: null,
    validator: null,
  });
  adapter.registerRoute({
    method: HttpMethod.GET,
    path: '/denied',
    middlewares: [],
    handler: () => {
      throw new HTTPException(401, { message: 'Unauthorized' });
    },
    staticServe: null,
    validator: null,
  });

  if (onError === 'answers') {
    adapter.onError((error, context) =>
      context.send({ error: error.message }, error instanceof HTTPException ? error.status : 500),
    );
  } else if (onError === 'declines') {
    // The ordinary way to say "not mine, use the default"
    adapter.onError((() => undefined) as any);
  } else if (onError === 'throws') {
    adapter.onError(() => {
      throw new Error('handler exploded');
    });
  }

  if (onNotFound === 'answers') {
    adapter.onNotFound((context) => context.send({ mine: true }, 404));
  } else if (onNotFound === 'throws') {
    adapter.onNotFound(() => {
      throw new Error('notFound exploded');
    });
  }

  return adapter;
};

describe('HonoAdapter error logging', () => {
  let server: { stop: (force?: boolean) => void; port: number } | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  describe('no application handler - the framework answers, so the framework records it', () => {
    it('logs 5xx at error level with a stack', async () => {
      const { logger, entries } = capturingLogger();

      server = (await buildAdapter(logger).start()) as any;

      const response = await fetch(`http://localhost:${server.port}/boom`);

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Internal Server Error' });

      const entry = entries.find((e) => e.message === 'Application error occurred:');

      expect(entry?.level).toBe('error');
      expect(entry?.meta.status).toBe(500);
      expect(typeof entry?.meta.stack).toBe('string');
    });

    it('logs 4xx at debug level without a stack', async () => {
      const { logger, entries } = capturingLogger();

      server = (await buildAdapter(logger).start()) as any;

      await fetch(`http://localhost:${server.port}/denied`);

      const entry = entries.find((e) => e.message === 'Request rejected:');

      expect(entry?.level).toBe('debug');
      expect(entry?.meta.status).toBe(401);
      expect(entry?.meta.stack).toBeUndefined();
      // a 401 must never reach the error stream - that is the log-amplification case
      expect(entries.some((e) => e.level === 'error')).toBe(false);
    });

    it('falls back to info when the logger has no debug method', async () => {
      const { logger, entries } = capturingLogger();

      delete (logger as any).debug;

      server = (await buildAdapter(logger).start()) as any;

      await fetch(`http://localhost:${server.port}/denied`);

      const entry = entries.find((e) => e.message === 'Request rejected:');

      expect(entry?.level).toBe('info');
    });

    it('logs nothing when logErrors is false', async () => {
      const { logger, entries } = capturingLogger();

      server = (await buildAdapter(logger, { logErrors: false }).start()) as any;

      await fetch(`http://localhost:${server.port}/boom`);
      await fetch(`http://localhost:${server.port}/denied`);

      expect(entries.some((e) => e.message === 'Application error occurred:')).toBe(false);
      expect(entries.some((e) => e.message === 'Request rejected:')).toBe(false);
    });
  });

  describe('an application handler that answers - the framework stays quiet', () => {
    it('an onError that returns a Response produces no framework line', async () => {
      const { logger, entries } = capturingLogger();

      server = (await buildAdapter(logger, { onError: 'answers' }).start()) as any;

      const response = await fetch(`http://localhost:${server.port}/boom`);

      expect(response.status).toBe(500);
      // The application's own body, so the application is the one that logged it - with whatever
      // correlation id it carries. A second line from the adapter would only duplicate it.
      expect(await response.json()).toEqual({ error: 'kaboom' });

      expect(entries.some((e) => e.message === 'Application error occurred:')).toBe(false);
    });

    it('the same holds for a 4xx', async () => {
      const { logger, entries } = capturingLogger();

      server = (await buildAdapter(logger, { onError: 'answers' }).start()) as any;

      const response = await fetch(`http://localhost:${server.port}/denied`);

      expect(response.status).toBe(401);

      expect(entries.some((e) => e.message === 'Request rejected:')).toBe(false);
      expect(entries.some((e) => e.message === 'Application error occurred:')).toBe(false);
    });
  });

  describe('an application handler that does not answer - the framework records it anyway', () => {
    it('an onError that returns nothing still logs the original error', async () => {
      const { logger, entries } = capturingLogger();

      server = (await buildAdapter(logger, { onError: 'declines' }).start()) as any;

      const response = await fetch(`http://localhost:${server.port}/boom`);

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Internal Server Error' });

      // Without this the ordinary "not mine, use the default" return would swallow a 500 with
      // no trace anywhere - neither the application nor the framework would have recorded it.
      const entry = entries.find((e) => e.message === 'Application error occurred:');

      expect(entry?.level).toBe('error');
      expect(entry?.meta.message).toBe('kaboom');
    });

    it('an onError that throws records both its own failure and the original error', async () => {
      const { logger, entries } = capturingLogger();

      server = (await buildAdapter(logger, { onError: 'throws' }).start()) as any;

      const response = await fetch(`http://localhost:${server.port}/boom`);

      expect(response.status).toBe(500);

      expect(entries.some((e) => e.message.includes('Error handler threw an error'))).toBe(true);

      const original = entries.find((e) => e.message === 'Application error occurred:');

      expect(original?.meta.message).toBe('kaboom');
    });
  });

  describe('unmatched routes', () => {
    it('the default 404 is logged at info', async () => {
      const { logger, entries } = capturingLogger();

      server = (await buildAdapter(logger).start()) as any;

      const response = await fetch(`http://localhost:${server.port}/nope/deep?x=1`, { method: 'POST' });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Not Found' });

      const entry = entries.find((e) => e.message === 'Route not found:');

      // info, not warn: a scanner walking /wp-admin and /.env must not fill the warning stream.
      // Not debug either: a 404 nobody can see is how a mistyped route survives to production.
      expect(entry?.level).toBe('info');
      expect(entry?.meta).toEqual({ path: '/nope/deep', method: 'POST', status: 404 });
    });

    it('an onNotFound that answers produces no framework line', async () => {
      const { logger, entries } = capturingLogger();

      server = (await buildAdapter(logger, { onNotFound: 'answers' }).start()) as any;

      const response = await fetch(`http://localhost:${server.port}/nope`);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ mine: true });

      expect(entries.some((e) => e.message === 'Route not found:')).toBe(false);
    });

    it('an onNotFound that throws falls back to the default and logs it', async () => {
      const { logger, entries } = capturingLogger();

      server = (await buildAdapter(logger, { onNotFound: 'throws' }).start()) as any;

      const response = await fetch(`http://localhost:${server.port}/nope`);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Not Found' });

      expect(entries.some((e) => e.message.includes('onNotFound threw an error'))).toBe(true);
      expect(entries.some((e) => e.message === 'Route not found:')).toBe(true);
    });

    it('logErrors: false silences the 404 line too', async () => {
      const { logger, entries } = capturingLogger();

      server = (await buildAdapter(logger, { logErrors: false }).start()) as any;

      const response = await fetch(`http://localhost:${server.port}/nope`);

      expect(response.status).toBe(404);
      expect(entries.some((e) => e.message === 'Route not found:')).toBe(false);
    });
  });
});
