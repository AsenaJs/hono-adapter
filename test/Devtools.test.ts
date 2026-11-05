import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Context as HonoContext } from 'hono';
import { z } from 'zod';
import { HttpException } from '@asenajs/asena/adapter';
import { HttpMethod } from '@asenajs/asena/web-types';
import type { HonoAdapter } from '../lib/HonoAdapter';
import type { Context } from '../lib/defaults';
import type { HonoDevtoolsBus, HonoDevtoolsStep, HonoDevtoolsStepKind } from '../lib/types';
import { createTestAdapter, createTestMiddleware, registerRoute } from './utils/testHelpers';

interface FakeRecord {
  method: string;
  path: string;
  steps: HonoDevtoolsStep[];
}

interface ClosedRecord {
  method: string;
  path: string;
  status: number;
  steps: HonoDevtoolsStep[];
  answeredBy: HonoDevtoolsStep | undefined;
}

/** Mirrors core's DevtoolsBus: records are correlated through AsyncLocalStorage, never through a context. */
const createFakeBus = () => {
  const storage = new AsyncLocalStorage<FakeRecord>();
  const closed: ClosedRecord[] = [];
  let opened = 0;

  const bus: HonoDevtoolsBus<FakeRecord> = {
    enabled: true,
    open: (method, path) => {
      opened += 1;

      return { method, path, steps: [] };
    },
    run: (record, fn) => storage.run(record, fn),
    step: (kind, name) => {
      storage.getStore()?.steps.push({ kind, name });
    },
    close: (record, status, answeredBy) => {
      closed.push({
        method: record.method,
        path: record.path,
        status,
        steps: [...record.steps],
        answeredBy: answeredBy ?? record.steps.at(-1),
      });
    },
  };

  /** What core's prepared handles do when its bus is enabled. */
  const core = <A extends unknown[], R>(kind: HonoDevtoolsStepKind, name: string, fn: (...args: A) => R) => {
    return (...args: A): R => {
      bus.step(kind, name);

      return fn(...args);
    };
  };

  return { bus, closed, core, opened: () => opened };
};

const randomPort = () => 10000 + Math.floor(Math.random() * 22000);

const adapterDefault: HonoDevtoolsStep = { kind: 'adapter-default', name: 'HonoAdapter' };

describe('HonoAdapter devtools', () => {
  let adapter: HonoAdapter;
  let fake: ReturnType<typeof createFakeBus>;
  let baseUrl: string;

  const setup = (attach = true) => {
    adapter = createTestAdapter().adapter;
    adapter.setPort(randomPort());
    fake = createFakeBus();

    if (attach) adapter.attachDevtools(fake.bus);
  };

  const boot = async () => {
    const server = await adapter.start();

    baseUrl = `http://localhost:${server.port}`;
  };

  /** The record is closed after the response is handed back, so give the wrapper its turn. */
  const settled = async (count = 1) => {
    for (let i = 0; i < 50 && fake.closed.length < count; i++) {
      await Bun.sleep(1);
    }

    return fake.closed;
  };

  afterEach(async () => {
    await adapter?.stop();
  });

  describe('not attached', () => {
    test('serves app.fetch itself, unwrapped', async () => {
      setup(false);
      await registerRoute(adapter, { path: '/notes' });

      const serve = spyOn(Bun, 'serve');

      try {
        await boot();

        expect(serve).toHaveBeenCalledTimes(1);
        expect((serve.mock.calls[0][0] as { fetch: unknown }).fetch).toBe(adapter.app.fetch);
      } finally {
        serve.mockRestore();
      }

      const response = await fetch(`${baseUrl}/notes`);

      expect(response.status).toBe(200);
      expect(fake.opened()).toBe(0);
    });

    test('adds nothing to the validator middleware', async () => {
      setup(false);
      await registerRoute(adapter, {
        method: HttpMethod.POST,
        path: '/notes',
        validator: { json: { handle: () => z.object({ title: z.string() }), override: false } },
      });
      await boot();

      const response = await fetch(`${baseUrl}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      expect(fake.opened()).toBe(0);
      expect(fake.closed).toEqual([]);
    });
  });

  describe('attached', () => {
    test('wraps the fetch entry', async () => {
      setup();
      await registerRoute(adapter, { path: '/notes' });

      const serve = spyOn(Bun, 'serve');

      try {
        await boot();

        expect((serve.mock.calls[0][0] as { fetch: unknown }).fetch).not.toBe(adapter.app.fetch);
      } finally {
        serve.mockRestore();
      }
    });

    test('a matched route closes with its status and the steps core recorded', async () => {
      setup();
      await registerRoute(adapter, {
        path: '/notes/:id',
        middlewares: [
          { handle: fake.core('middleware', 'AuditMiddleware.handle', async (_c, next) => next()), override: false },
        ],
        handler: fake.core('controller', 'NoteController.find', (ctx: Context) => ctx.send({ ok: true }, 201)),
      });
      await boot();

      const response = await fetch(`${baseUrl}/notes/7?full=1`, { method: 'GET' });

      expect(response.status).toBe(201);
      expect(await settled()).toEqual([
        {
          method: 'GET',
          path: '/notes/7',
          status: 201,
          steps: [
            { kind: 'middleware', name: 'AuditMiddleware.handle' },
            { kind: 'controller', name: 'NoteController.find' },
          ],
          answeredBy: { kind: 'controller', name: 'NoteController.find' },
        },
      ]);
    });

    test('global middleware steps land in the record of the request that ran them', async () => {
      setup();
      adapter.use({
        handle: fake.core('global-middleware', 'TraceMiddleware.handle', async (_c, next) => next()),
        override: false,
      });
      await registerRoute(adapter, {
        path: '/notes',
        handler: fake.core('controller', 'NoteController.list', (ctx: Context) => ctx.send([])),
      });
      await boot();

      await fetch(`${baseUrl}/notes`);

      expect((await settled())[0].steps).toEqual([
        { kind: 'global-middleware', name: 'TraceMiddleware.handle' },
        { kind: 'controller', name: 'NoteController.list' },
      ]);
    });

    test('concurrent requests keep their own records', async () => {
      setup();
      await registerRoute(adapter, {
        path: '/slow',
        handler: fake.core('controller', 'NoteController.slow', async (ctx: Context) => {
          await Bun.sleep(20);

          return ctx.send({ slow: true });
        }),
      });
      await registerRoute(adapter, {
        path: '/fast',
        handler: fake.core('controller', 'NoteController.fast', (ctx: Context) => ctx.send({ fast: true })),
      });
      await boot();

      await Promise.all([fetch(`${baseUrl}/slow`), fetch(`${baseUrl}/fast`)]);

      const records = await settled(2);

      expect(records.find((record) => record.path === '/slow')?.steps).toEqual([
        { kind: 'controller', name: 'NoteController.slow' },
      ]);
      expect(records.find((record) => record.path === '/fast')?.steps).toEqual([
        { kind: 'controller', name: 'NoteController.fast' },
      ]);
    });

    test('an override middleware gets the raw hono Context and its step still lands in the record', async () => {
      setup();

      let received: unknown;

      await registerRoute(adapter, {
        path: '/raw',
        middlewares: [
          {
            handle: fake.core('middleware', 'RawMiddleware.handle', async (c: any, next: () => Promise<void>) => {
              received = c;
              await next();
            }),
            override: true,
          },
        ],
        handler: fake.core('controller', 'NoteController.raw', (ctx: Context) => ctx.send({ ok: true })),
      });
      await boot();

      await fetch(`${baseUrl}/raw`);

      // Hono's own Context has `req.raw`; the Asena wrapper does not expose one.
      expect((received as HonoContext).req.raw).toBeInstanceOf(Request);
      expect((await settled())[0].steps).toEqual([
        { kind: 'middleware', name: 'RawMiddleware.handle' },
        { kind: 'controller', name: 'NoteController.raw' },
      ]);
    });

    test('a middleware answering false closes the record with 403 and that middleware as the answer', async () => {
      setup();
      await registerRoute(adapter, {
        path: '/guarded',
        middlewares: [
          { handle: fake.core('middleware', 'GuardMiddleware.handle', async () => false), override: false },
        ],
        handler: fake.core('controller', 'NoteController.guarded', (ctx: Context) => ctx.send({ ok: true })),
      });
      await boot();

      const response = await fetch(`${baseUrl}/guarded`);

      expect(response.status).toBe(403);
      expect(await settled()).toEqual([
        {
          method: 'GET',
          path: '/guarded',
          status: 403,
          steps: [{ kind: 'middleware', name: 'GuardMiddleware.handle' }],
          answeredBy: { kind: 'middleware', name: 'GuardMiddleware.handle' },
        },
      ]);
    });

    test('a websocket upgrade request is not recorded', async () => {
      setup();
      await registerRoute(adapter, { path: '/notes' });
      await boot();

      await fetch(`${baseUrl}/notes`, { headers: { Connection: 'Upgrade', Upgrade: 'websocket' } });
      await Bun.sleep(5);

      expect(fake.opened()).toBe(0);
    });

    describe('unmatched routes', () => {
      test('with no onNotFound the adapter answers and records itself as the not-found step', async () => {
        setup();
        await boot();

        const response = await fetch(`${baseUrl}/missing/deep`, { method: 'POST' });

        expect(response.status).toBe(404);
        expect(await settled()).toEqual([
          { method: 'POST', path: '/missing/deep', status: 404, steps: [adapterDefault], answeredBy: adapterDefault },
        ]);
      });

      test('an onNotFound that answers is not followed by an adapter step', async () => {
        setup();
        adapter.onNotFound(
          fake.core('not-found', 'NoteNotFound.handle', (ctx: Context) => ctx.send({ missing: true }, 404)),
        );
        await boot();

        await fetch(`${baseUrl}/missing`);

        expect(await settled()).toEqual([
          {
            method: 'GET',
            path: '/missing',
            status: 404,
            steps: [{ kind: 'not-found', name: 'NoteNotFound.handle' }],
            answeredBy: { kind: 'not-found', name: 'NoteNotFound.handle' },
          },
        ]);
      });

      test('an onNotFound that declines hands the answer to the adapter', async () => {
        setup();
        adapter.onNotFound(fake.core('not-found', 'NoteNotFound.handle', () => undefined));
        await boot();

        await fetch(`${baseUrl}/missing`);

        expect((await settled())[0]).toMatchObject({
          status: 404,
          steps: [{ kind: 'not-found', name: 'NoteNotFound.handle' }, adapterDefault],
          answeredBy: adapterDefault,
        });
      });
    });

    describe('adapter-default', () => {
      test('a throw with no onError is answered by the adapter', async () => {
        setup();
        await registerRoute(adapter, {
          path: '/boom',
          handler: fake.core('controller', 'NoteController.boom', () => {
            throw new Error('boom');
          }),
        });
        await boot();

        const response = await fetch(`${baseUrl}/boom`);

        expect(response.status).toBe(500);
        expect((await settled())[0]).toMatchObject({
          status: 500,
          steps: [{ kind: 'controller', name: 'NoteController.boom' }, adapterDefault],
          answeredBy: adapterDefault,
        });
      });

      test('an onError that declines is followed by the adapter', async () => {
        setup();
        adapter.onError(fake.core('config-onError', 'AppConfig.onError', () => undefined) as any);
        await registerRoute(adapter, {
          path: '/boom',
          handler: fake.core('controller', 'NoteController.boom', () => {
            throw new HttpException(409, { error: 'conflict' });
          }),
        });
        await boot();

        const response = await fetch(`${baseUrl}/boom`);

        expect(response.status).toBe(409);
        expect((await settled())[0]).toMatchObject({
          status: 409,
          steps: [
            { kind: 'controller', name: 'NoteController.boom' },
            { kind: 'config-onError', name: 'AppConfig.onError' },
            adapterDefault,
          ],
          answeredBy: adapterDefault,
        });
      });

      test('an onError that answers is not followed by the adapter', async () => {
        setup();
        adapter.onError(
          fake.core('config-onError', 'AppConfig.onError', (_error: Error, ctx: Context) =>
            ctx.send({ handled: true }, 418),
          ) as any,
        );
        await registerRoute(adapter, {
          path: '/boom',
          handler: fake.core('controller', 'NoteController.boom', () => {
            throw new Error('boom');
          }),
        });
        await boot();

        await fetch(`${baseUrl}/boom`);

        expect((await settled())[0]).toMatchObject({
          status: 418,
          steps: [
            { kind: 'controller', name: 'NoteController.boom' },
            { kind: 'config-onError', name: 'AppConfig.onError' },
          ],
          answeredBy: { kind: 'config-onError', name: 'AppConfig.onError' },
        });
      });

      test('a thrown non-Error is answered by the adapter', async () => {
        setup();
        await registerRoute(adapter, {
          path: '/boom',
          handler: fake.core('controller', 'NoteController.boom', () => {
            throw 'text';
          }),
        });
        await boot();

        const response = await fetch(`${baseUrl}/boom`);

        expect(response.status).toBe(500);
        expect((await settled())[0].answeredBy).toEqual(adapterDefault);
      });

      test('a fetch that rejects closes the record as an adapter 500 and rethrows', async () => {
        setup();

        const failure = new Error('fetch failed');
        const wrapped = (adapter as any).recordRequests(fake.bus, () => Promise.reject(failure));

        await expect(wrapped(new Request('http://localhost/notes?x=1', { method: 'DELETE' }))).rejects.toBe(failure);
        expect(fake.closed).toEqual([
          { method: 'DELETE', path: '/notes', status: 500, steps: [], answeredBy: adapterDefault },
        ]);
      });
    });

    describe('legacy validator', () => {
      const noteSchema = () => z.object({ title: z.string() });

      const post = (body: unknown) =>
        fetch(`${baseUrl}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

      const registerValidated = (validatorCache: boolean, json: unknown = { handle: noteSchema, override: false }) =>
        adapter.registerRoute({
          method: HttpMethod.POST,
          path: '/notes',
          middlewares: [],
          handler: fake.core('controller', 'NoteController.create', (ctx: Context) => ctx.send({ ok: true }, 201)),
          staticServe: null,
          validator: { json },
          validatorCache,
          controllerName: 'NoteController',
        } as any);

      for (const validatorCache of [true, false]) {
        describe(validatorCache ? 'cached schema' : 'schema per request', () => {
          test('a passing body records the validator before the controller', async () => {
            setup();
            await registerValidated(validatorCache);
            await boot();

            const response = await post({ title: 'groceries' });

            expect(response.status).toBe(201);
            expect((await settled())[0].steps).toEqual([
              { kind: 'validator', name: 'json' },
              { kind: 'controller', name: 'NoteController.create' },
            ]);
          });

          test('a failing body records the validator, then the adapter answer', async () => {
            setup();
            await registerValidated(validatorCache);
            await boot();

            const response = await post({ title: 7 });

            expect(response.status).toBe(400);
            expect((await settled())[0]).toMatchObject({
              status: 400,
              steps: [{ kind: 'validator', name: 'json' }, adapterDefault],
              answeredBy: adapterDefault,
            });
          });
        });
      }

      test('a hook that answers makes the validator the answering step', async () => {
        setup();
        await registerValidated(true, {
          handle: () => ({
            schema: noteSchema(),
            hook: (result: { success: boolean }, c: HonoContext) =>
              result.success ? undefined : c.json({ invalid: true }, 422),
          }),
          override: false,
        });
        await boot();

        const response = await post({});

        expect(response.status).toBe(422);
        expect((await settled())[0]).toMatchObject({
          status: 422,
          steps: [{ kind: 'validator', name: 'json' }],
          answeredBy: { kind: 'validator', name: 'json' },
        });
      });
    });
  });
});
