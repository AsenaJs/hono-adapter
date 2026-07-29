import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { HTTPException } from 'hono/http-exception';
import { HttpException, isHttpException } from '@asenajs/asena/adapter';
import { HttpMethod } from '@asenajs/asena/web-types';
import type { ServerLogger } from '@asenajs/asena/logger';
import { HonoAdapter } from '../lib/HonoAdapter';
import { isNestedHonoPath, warnOnNestedHono } from '../lib/errors';

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
 * The incident, reduced to a unit test.
 *
 * A downstream application bumped `hono: ^4.12.9 -> ^4.12.32` in its own `package.json`. Bun kept
 * the adapter's already-satisfied copy nested under `@asenajs/hono-adapter/node_modules/hono`, and
 * every deliberate 400/403 thrown from `hono/http-exception` silently became a 500 while the API
 * kept answering. Nothing crashed and no test failed.
 *
 * `brandHonoHttpException()` patches the prototype of the class *this package* resolved; a
 * prototype patch cannot reach another copy's class. So a foreign `HTTPException` is neither
 * `instanceof` the adapter's class nor branded, and `defaultErrorResponse` has nothing to
 * recognise it by.
 *
 * **This test pins that behaviour rather than fixing it, because it cannot be fixed here.** The fix
 * is packaging: since 3.0.0 `hono` is a peer dependency, so the adapter has no resolution slot of
 * its own and the second copy cannot come into existence in the first place. What this file does is
 * make the consequence explicit and permanent, so nobody re-introduces the dependency thinking the
 * brand covers it.
 *
 * `hono/dist/http-exception.js` has zero imports - it is a bare `class HTTPException extends Error`
 * - so copying the file to a second location produces a genuinely distinct class rather than a
 * module that resolves back to the shared one. Same technique as `HttpExceptionTwoCopies.test.ts`.
 */
describe('a second resolved copy of hono', () => {
  const copyDir = join(import.meta.dir, '.hono-two-copies-fixture');

  let ForeignHTTPException: typeof HTTPException;
  let server: { stop: (force?: boolean) => void; port: number } | undefined;

  beforeAll(async () => {
    rmSync(copyDir, { recursive: true, force: true });
    mkdirSync(copyDir, { recursive: true });

    const honoEntry = Bun.resolveSync('hono/http-exception', import.meta.dir);

    cpSync(honoEntry, join(copyDir, 'http-exception.js'));

    const foreign = await import(join(copyDir, 'http-exception.js'));

    ForeignHTTPException = foreign.HTTPException;
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
    // If this ever fails, the fixture collapsed back into one module and every assertion below
    // silently stops testing anything.
    expect(ForeignHTTPException).not.toBe(HTTPException);
    expect(new ForeignHTTPException(403) instanceof HTTPException).toBe(false);
  });

  test('the brand does not cross copies - this is the whole problem', () => {
    // eslint-disable-next-line no-new
    new HonoAdapter({ logger: capturingLogger().logger });

    expect(isHttpException(new HTTPException(403, { message: 'x' }))).toBe(true);
    expect(isHttpException(new ForeignHTTPException(403, { message: 'x' }))).toBe(false);
  });

  // The documented failure, asserted as-is. A foreign hono exception carries no brand and is not
  // an instance of the adapter's class, so there is nothing left to recognise it by and it takes
  // the generic branch. Packaging is what stops an application ever reaching this state.
  test('a foreign HTTPException is answered 500, not its own status', async () => {
    const { response } = await bootThrowing(new ForeignHTTPException(403, { message: 'forbidden' }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal Server Error' });
  });

  test("the adapter's own copy is answered correctly, so the difference is the copy and nothing else", async () => {
    const { response } = await bootThrowing(new HTTPException(403, { message: 'forbidden' }));

    expect(response.status).toBe(403);
    expect(await response.text()).toBe('forbidden');
  });

  // The portable class brands each *instance*, so it does not depend on which copy of
  // `@asenajs/asena` constructed it. This is why the docs tell applications to throw this one.
  test('core HttpException is immune - it brands the instance, not a prototype', async () => {
    const { response } = await bootThrowing(new HttpException(403, { error: 'forbidden' }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
  });
});

describe('warnOnNestedHono', () => {
  // The predicate is tested directly rather than through the real resolver: inside this repo
  // `import.meta.resolve` always answers `hono-adapter/node_modules/hono` - the package's own root,
  // which correctly does not match - so driving the resolver could only ever assert the negative
  // case and would pass just as happily against a function that returned early every time.
  test('matches the installed layout where hono is nested under the adapter', () => {
    expect(
      isNestedHonoPath('file:///app/node_modules/@asenajs/hono-adapter/node_modules/hono/dist/http-exception.js'),
    ).toBe(true);
  });

  test('does not match hono resolved from the application, which is what a peer produces', () => {
    expect(isNestedHonoPath('file:///app/node_modules/hono/dist/http-exception.js')).toBe(false);
  });

  test('does not match this repo, where hono is a devDependency at the package root', () => {
    expect(isNestedHonoPath(import.meta.resolve('hono/http-exception'))).toBe(false);
  });

  test('says nothing here, and never throws whatever the resolution environment', () => {
    const messages: string[] = [];

    warnOnNestedHono({ warn: (message) => messages.push(message) });

    expect(messages).toHaveLength(0);
    expect(() => warnOnNestedHono()).not.toThrow();
  });
});
