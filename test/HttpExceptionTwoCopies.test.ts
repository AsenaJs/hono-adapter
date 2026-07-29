import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { HTTP_EXCEPTION, HttpException } from '@asenajs/asena/adapter';
import { HttpMethod } from '@asenajs/asena/web-types';
import type { ServerLogger } from '@asenajs/asena/logger';
import { HonoAdapter } from '../lib/HonoAdapter';

interface Entry {
  level: string;
  message: string;
  meta?: any;
}

const capturingLogger = () => {
  const entries: Entry[] = [];

  const logger: ServerLogger & { debug: (message: string, meta?: any) => void } = {
    info: (message, meta) => entries.push({ level: 'info', message, meta }),
    warn: (message, meta) => entries.push({ level: 'warn', message, meta }),
    error: (message, meta) => entries.push({ level: 'error', message, meta }),
    profile: () => {},
    debug: (message, meta) => entries.push({ level: 'debug', message, meta }),
  };

  return { logger, entries };
};

/**
 * The twin of `ergenecore/test/HttpExceptionTwoCopies.test.ts`, and new to this adapter.
 *
 * `HttpException` now lives in `@asenajs/asena/adapter`, which is a **peer** dependency of this
 * package - so an application resolving two copies of it produces two distinct `HttpException`
 * classes, and `instanceof` answers false for one of them. That is the topology the
 * `Symbol.for('asena.httpException')` brand exists for.
 *
 * This adapter never had a foreign-copy branch at all: its default response was chosen purely by
 * `error instanceof HTTPException`, so a foreign exception answered a generic 500 while the log
 * line - computed separately, by duck-typing `.status` - claimed the status it carried. The
 * response and the record disagreed about the same request, which is worse than either being
 * wrong on its own.
 *
 * A hand-built object cannot prove the fix: it is not an instance of anything, so `instanceof`
 * was always going to answer false for it. This copies the built core module - which has no
 * imports at all after `import type` erasure, and declares the registered symbol in-file - so the
 * copy is a genuinely distinct class carrying an identical brand.
 */
describe('HttpException from a second resolved copy of @asenajs/asena', () => {
  const copyDir = join(import.meta.dir, '.two-copies-fixture');

  let ForeignHttpException: typeof HttpException;
  let server: { stop: (force?: boolean) => void; port: number } | undefined;

  beforeAll(async () => {
    rmSync(copyDir, { recursive: true, force: true });
    mkdirSync(copyDir, { recursive: true });

    const coreAdapterEntry = Bun.resolveSync('@asenajs/asena/adapter', import.meta.dir);

    cpSync(join(dirname(coreAdapterEntry), 'types', 'HttpException.js'), join(copyDir, 'HttpException.js'));

    const foreign = await import(join(copyDir, 'HttpException.js'));

    ForeignHttpException = foreign.HttpException;

    // If the core module ever grows a runtime import, the copy resolves it back to the shared
    // module and stops being a second copy in the way that matters.
    expect(foreign.HTTP_EXCEPTION).toBe(HTTP_EXCEPTION);
  });

  afterAll(() => {
    rmSync(copyDir, { recursive: true, force: true });
  });

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  const bootThrowing = async (error: unknown) => {
    const { logger, entries } = capturingLogger();
    const adapter = new HonoAdapter({ logger });

    adapter.setPort(0);
    adapter.registerRoute({
      method: HttpMethod.GET,
      path: '/denied',
      middlewares: [],
      handler: () => {
        throw error;
      },
      staticServe: null,
      validator: null,
    });

    server = (await adapter.start()) as any;

    const response = await fetch(`http://localhost:${server!.port}/denied`);

    return { response, entries };
  };

  test('the copy really is a different class', () => {
    const foreign = new ForeignHttpException(401, 'Unauthorized');

    // If this ever passes, the copy collapsed back into one module and every assertion below
    // silently stops testing anything.
    expect(foreign instanceof HttpException).toBe(false);
    expect(foreign.status).toBe(401);
  });

  test('a foreign 401 is answered 401, not 500', async () => {
    const { response } = await bootThrowing(new ForeignHttpException(401, { error: 'Unauthorized' }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  test('a foreign 401 is logged as a rejected request, not an application error', async () => {
    const { entries } = await bootThrowing(new ForeignHttpException(401, 'Unauthorized'));

    expect(entries.some((entry) => entry.level === 'error')).toBe(false);

    const entry = entries.find((e) => e.message === 'Request rejected:');

    expect(entry?.level).toBe('debug');
    expect(entry?.meta.status).toBe(401);
    // A stack on a 4xx is the payload of the flood, not just the wrong label.
    expect(entry?.meta.stack).toBeUndefined();
  });

  test('a foreign 5xx is still an application error with a stack', async () => {
    const { response, entries } = await bootThrowing(new ForeignHttpException(503, 'Upstream down'));

    expect(response.status).toBe(503);

    const entry = entries.find((e) => e.message === 'Application error occurred:');

    expect(entry?.level).toBe('error');
    expect(entry?.meta.status).toBe(503);
    expect(typeof entry?.meta.stack).toBe('string');
  });

  test('a foreign subclass is treated the same as a foreign base', async () => {
    class ForeignForbidden extends ForeignHttpException {
      public constructor() {
        super(403, { error: 'Forbidden' });
      }
    }

    const { response, entries } = await bootThrowing(new ForeignForbidden());

    expect(response.status).toBe(403);
    expect(entries.some((entry) => entry.level === 'error')).toBe(false);
    expect(entries.find((e) => e.message === 'Request rejected:')?.meta.status).toBe(403);
  });

  test('the local copy behaves identically, so the two cannot drift', async () => {
    const { response, entries } = await bootThrowing(new HttpException(401, { error: 'Unauthorized' }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(entries.find((e) => e.message === 'Request rejected:')?.meta.status).toBe(401);
  });
});
