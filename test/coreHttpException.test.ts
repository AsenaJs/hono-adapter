import { afterEach, describe, expect, it } from 'bun:test';
import { HTTP_EXCEPTION, HttpException, isHttpException } from '@asenajs/asena/adapter';
import { HttpMethod } from '@asenajs/asena/web-types';
import type { ServerLogger } from '@asenajs/asena/logger';
import { HTTPException } from 'hono/http-exception';
import { basicAuth } from 'hono/basic-auth';
import { bearerAuth } from 'hono/bearer-auth';
import { z } from 'zod';
import { HonoAdapter } from '../lib/HonoAdapter';

/**
 * `HttpException` is declared in `@asenajs/asena/adapter` and is the class applications throw on
 * *both* adapters - the same class object, so one `throw` behaves identically whichever adapter
 * the application runs on. This adapter deliberately does not re-export it.
 *
 * This adapter is the one where that could go wrong. Its default response used to be chosen by
 * `error instanceof HTTPException`, which is false for the core class, so a `throw new
 * HttpException(401, ...)` would have answered a generic 500 while the log line - chosen by a
 * separate duck-type on `.status` - claimed 401. Two mechanisms, two answers, for one request.
 *
 * The other half of this file is the regression guard that matters more: hono's own
 * `HTTPException` must keep working exactly as before, because `hono/basic-auth`,
 * `hono/bearer-auth`, `hono/jwt` and hono's own validator all throw it and applications depend on
 * those packages.
 */
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

describe('core HttpException on the hono adapter', () => {
  let server: { stop: (force?: boolean) => void; port: number } | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  /** Boots an adapter whose single route throws `error`, with the requested `onError` behaviour. */
  const bootThrowing = async (error: unknown, onError: 'none' | 'answers' | 'declines' = 'none') => {
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

    if (onError === 'answers') {
      adapter.onError((thrown, context) =>
        isHttpException(thrown) ? context.send({ mine: true }, thrown.status) : context.send({ mine: false }, 500),
      );
    } else if (onError === 'declines') {
      adapter.onError((() => undefined) as any);
    }

    server = (await adapter.start()) as any;

    const response = await fetch(`http://localhost:${server!.port}/denied`);

    return { response, entries };
  };

  describe('the adapter answers it from its own status and body', () => {
    it('with no onError declared', async () => {
      const { response } = await bootThrowing(
        new HttpException(401, { error: 'nope' }, { headers: { 'WWW-Authenticate': 'Bearer' } }),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'nope' });
      expect(response.headers.get('content-type')).toContain('application/json');
      // Proves `getResponse()` produced this rather than a status-only fallback: a fallback has
      // no way to know about a custom header.
      expect(response.headers.get('WWW-Authenticate')).toBe('Bearer');
    });

    it('when onError declines by returning nothing', async () => {
      const { response, entries } = await bootThrowing(new HttpException(401, { error: 'nope' }), 'declines');

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'nope' });

      // The framework answered, so the framework records it - at a level matching the status.
      const entry = entries.find((e) => e.message === 'Request rejected:');

      expect(entry?.level).toBe('debug');
      expect(entry?.meta.status).toBe(401);
      expect(entry?.meta.stack).toBeUndefined();
    });

    it('yields to onError when it answers, and writes no line of its own', async () => {
      const { response, entries } = await bootThrowing(new HttpException(403, 'Forbidden'), 'answers');

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ mine: true });

      // The application answered, so it owns the record - a second line from the adapter would
      // only duplicate it, without whatever correlation id the application carries.
      expect(entries.some((e) => e.message === 'Request rejected:')).toBe(false);
      expect(entries.some((e) => e.message === 'Application error occurred:')).toBe(false);
    });

    it('treats a 5xx as an application error, with a stack', async () => {
      const { response, entries } = await bootThrowing(new HttpException(503, 'Upstream down'));

      expect(response.status).toBe(503);
      expect(await response.text()).toBe('Upstream down');

      const entry = entries.find((e) => e.message === 'Application error occurred:');

      expect(entry?.level).toBe('error');
      expect(entry?.meta.status).toBe(503);
      expect(typeof entry?.meta.stack).toBe('string');
    });

    it("is branded, and is not hono's HTTPException", async () => {
      const error = new HttpException(401, 'Unauthorized');

      expect(isHttpException(error)).toBe(true);
      // The reason the adapter cannot dispatch on `instanceof HTTPException` alone.
      expect(error instanceof HTTPException).toBe(false);
    });
  });

  // Everything below is a regression guard. None of it is new behaviour; all of it would break
  // silently if the default response stopped recognising hono's own exception class.
  describe("hono's own HTTPException keeps working", () => {
    it('is answered from its own status and message', async () => {
      const { response } = await bootThrowing(new HTTPException(403, { message: 'Insufficient scope' }));

      expect(response.status).toBe(403);
      expect(await response.text()).toBe('Insufficient scope');
    });

    it('keeps the headers of a pre-built res', async () => {
      const res = new Response(JSON.stringify({ error: 'nope' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer realm="api"' },
      });

      const { response } = await bootThrowing(new HTTPException(401, { res }));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'nope' });
      expect(response.headers.get('WWW-Authenticate')).toBe('Bearer realm="api"');
    });

    // Hono throws this from inside the adapter's own validation chain, not from user code, so it
    // is on the hot path of every validated POST rather than an exotic case.
    it("survives hono's validator rejecting a malformed JSON body", async () => {
      const { logger } = capturingLogger();
      const adapter = new HonoAdapter({ logger });

      adapter.setPort(0);
      adapter.registerRoute({
        method: HttpMethod.POST,
        path: '/users',
        middlewares: [],
        handler: (context: any) => context.send({ ok: true }),
        staticServe: null,
        validator: { json: { handle: () => z.object({ name: z.string() }), override: false } } as any,
      });

      server = (await adapter.start()) as any;

      const response = await fetch(`http://localhost:${server!.port}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toBe('Malformed JSON in request body');
    });
  });

  // The path a real application takes to use a hono package: an `override` middleware receives the
  // raw hono context, so a hono middleware can be handed through untouched.
  describe('hono ecosystem middlewares, end to end', () => {
    const bootWithMiddleware = async (handle: unknown) => {
      const { logger, entries } = capturingLogger();
      const adapter = new HonoAdapter({ logger });

      adapter.setPort(0);
      adapter.registerRoute({
        method: HttpMethod.GET,
        path: '/vault',
        middlewares: [{ handle, override: true } as any],
        handler: (context: any) => context.send({ ok: true }),
        staticServe: null,
        validator: null,
      });

      server = (await adapter.start()) as any;

      return { entries, url: `http://localhost:${server!.port}/vault` };
    };

    it('bearerAuth still answers 401 with its WWW-Authenticate header', async () => {
      const { entries, url } = await bootWithMiddleware(bearerAuth({ token: 's3cr3t' }));

      const response = await fetch(url);

      expect(response.status).toBe(401);
      expect(response.headers.get('WWW-Authenticate')).toContain('Bearer');

      // And the rejection is logged as a rejection, not as an application error with a stack -
      // a bot spraying a public endpoint must not be able to fill the error stream.
      const entry = entries.find((e) => e.message === 'Request rejected:');

      expect(entry?.level).toBe('debug');
      expect(entry?.meta.status).toBe(401);
    });

    it('bearerAuth still lets a correct token through', async () => {
      const { url } = await bootWithMiddleware(bearerAuth({ token: 's3cr3t' }));

      const response = await fetch(url, { headers: { Authorization: 'Bearer s3cr3t' } });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    });

    it('basicAuth still answers 401', async () => {
      const { url } = await bootWithMiddleware(basicAuth({ username: 'admin', password: 'hunter2' }));

      const response = await fetch(url);

      expect(response.status).toBe(401);
      expect(response.headers.get('WWW-Authenticate')).toContain('Basic');
    });

    it('basicAuth still lets correct credentials through', async () => {
      const { url } = await bootWithMiddleware(basicAuth({ username: 'admin', password: 'hunter2' }));

      const response = await fetch(url, {
        headers: { Authorization: `Basic ${btoa('admin:hunter2')}` },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    });
  });

  describe('a branded exception this adapter does not own', () => {
    /** What a second resolved copy, or a foreign implementation of the contract, looks like. */
    const brandedOnly = (status: number, message = 'from somewhere else') =>
      Object.assign(Object.create(Error.prototype), { [HTTP_EXCEPTION]: true, status, message }) as unknown;

    it('answers its own status instead of collapsing to 500', async () => {
      const { response } = await bootThrowing(brandedOnly(429, 'slow down'));

      expect(response.status).toBe(429);
    });

    it('withholds its message - only status is in the contract', async () => {
      const { response } = await bootThrowing(brandedOnly(429, 'slow down'));

      expect(await response.json()).toEqual({ error: 'Internal Server Error' });
    });

    it('is logged at the level its status implies', async () => {
      const { entries } = await bootThrowing(brandedOnly(403));

      expect(entries.some((entry) => entry.level === 'error')).toBe(false);
      expect(entries.find((e) => e.message === 'Request rejected:')?.meta.status).toBe(403);
    });
  });

  // The invariant, stated once so the two mechanisms can never drift apart again. Both used to be
  // computed independently: the response by `instanceof`, the log by duck-typing `.status`.
  describe('the logged status always equals the answered status', () => {
    const cases: [string, unknown][] = [
      ['core HttpException 401', new HttpException(401, 'Unauthorized')],
      ['core HttpException 503', new HttpException(503, 'Upstream down')],
      ['hono HTTPException 401', new HTTPException(401, { message: 'Unauthorized' })],
      [
        'branded without getResponse',
        Object.assign(Object.create(Error.prototype), { [HTTP_EXCEPTION]: true, status: 401, message: 'x' }),
      ],
      ['plain Error', new Error('kaboom')],
      // The case the old duck-type got wrong on its own terms: answered 500, logged as a 4xx.
      ['plain Error with a stray .status', Object.assign(new Error('kaboom'), { status: 401 })],
    ];

    for (const [name, error] of cases) {
      it(name, async () => {
        const { response, entries } = await bootThrowing(error);

        const entry = entries.find(
          (e) => e.message === 'Request rejected:' || e.message === 'Application error occurred:',
        );

        expect(entry?.meta.status).toBe(response.status);
      });
    }
  });
});
