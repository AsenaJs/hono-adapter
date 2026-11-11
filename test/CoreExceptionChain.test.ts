import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { AsenaServerFactory } from '@asenajs/asena';
import * as decorators from '@asenajs/asena/decorators';
import { Config, Controller, Middleware } from '@asenajs/asena/decorators';
import { Get } from '@asenajs/asena/decorators/http';
import { HttpException } from '@asenajs/asena/adapter';
import type { ServerLogger } from '@asenajs/asena/logger';
import { createHonoAdapter } from '../lib/utils/createHonoAdapter';
import { ConfigService } from '../lib/defaults/ConfigService';
import { MiddlewareService } from '../lib/defaults/MiddlewareService';
import type { Context } from '../lib/defaults/Context';
import type { HonoAdapter } from '../lib/HonoAdapter';
import { REQUIRE_CHAIN_ENV, chainRequired, installedCoreVersion } from './utils/coreExceptionChain';

// The devDependency is the published 0.12, which has no `@Catch`: the specifier is not a literal so
// the file type-checks there, and the suite runs only against a core that ships the chain.
const exceptionModule: string = '@asenajs/asena/exception';
const exception: any = await import(exceptionModule).catch(() => undefined);
const ExceptionHandler: (() => ClassDecorator) | undefined = (decorators as any).ExceptionHandler;
const hasChain = exception !== undefined && ExceptionHandler !== undefined;
const coreVersion = installedCoreVersion();
const required = chainRequired({ coreVersion, flag: process.env[REQUIRE_CHAIN_ENV] });

const DEVTOOLS_HOOK = Symbol.for('asena.devtools');

interface Entry {
  level: string;
  message: string;
}

const capturingLogger = () => {
  const entries: Entry[] = [];
  const push = (level: string) => (message: string) => {
    entries.push({ level, message: String(message) });
  };

  const logger: ServerLogger = {
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
    profile: () => {},
  };

  return { logger, entries };
};

const defineApp = () => {
  const seen: unknown[] = [];
  const thrownObject = { code: 1 };

  @Middleware()
  class NumberThrowingMiddleware extends MiddlewareService {
    public async handle() {
      throw 42;
    }
  }

  @Controller('/notes')
  class NoteController {
    @Get('/text')
    public text() {
      throw 'text';
    }

    @Get('/object')
    public async object() {
      throw thrownObject;
    }

    @Get({ path: '/number', middlewares: [NumberThrowingMiddleware] })
    public number(context: Context) {
      return context.send({ reached: true });
    }

    @Get('/declined')
    public declined() {
      throw 'declined';
    }

    @Get('/rejected')
    public rejected() {
      return {
        then: (_resolve: unknown, reject: (reason: unknown) => void) => {
          setTimeout(() => reject('rejected'), 5);
        },
      };
    }

    @Get('/later')
    public later(context: Context) {
      return {
        then: (resolve: (value: unknown) => void) => {
          setTimeout(() => resolve(context.send({ later: true }, 202)), 5);
        },
      };
    }

    @Get('/teapot')
    public teapot() {
      throw new HttpException(418, { error: 'teapot' });
    }
  }

  @(ExceptionHandler!())
  class CatchAllHandler {
    @exception.Catch()
    public fallback(error: unknown, ctx: { scope: string; context: Context }) {
      seen.push(error);

      if (ctx.scope !== 'http' || error === 'declined') return undefined;

      return ctx.context.send({ caught: typeof error }, 422);
    }
  }

  @(ExceptionHandler!())
  class ErrorHandler {
    @exception.Catch(Error)
    public anyError(error: Error, ctx: { scope: string; context: Context }) {
      seen.push(error);

      if (ctx.scope !== 'http') return undefined;

      return ctx.context.send({ caught: error.constructor.name }, 409);
    }
  }

  @(ExceptionHandler!())
  class DecliningNotFoundHandler {
    @exception.NotFound()
    public missing() {
      seen.push('not-found');

      return undefined;
    }
  }

  @Config()
  class DecliningConfig extends ConfigService {
    public onError(error: Error): any {
      seen.push(['onError', error]);

      return undefined;
    }
  }

  return {
    seen,
    thrownObject,
    NumberThrowingMiddleware,
    NoteController,
    CatchAllHandler,
    ErrorHandler,
    DecliningNotFoundHandler,
    DecliningConfig,
  };
};

describe('the core this suite runs against', () => {
  test('a 0.13 core requires the chain, an older one does not', () => {
    expect(chainRequired({ coreVersion: '0.12.4' })).toBe(false);
    expect(chainRequired({ coreVersion: '0.13.0' })).toBe(true);
    expect(chainRequired({ coreVersion: '0.13.0-next.1' })).toBe(true);
    expect(chainRequired({ coreVersion: '1.0.0' })).toBe(true);
  });

  test(`${REQUIRE_CHAIN_ENV}=1 requires the chain on any core`, () => {
    expect(chainRequired({ coreVersion: '0.12.0', flag: '1' })).toBe(true);
    expect(chainRequired({ coreVersion: '0.12.0', flag: '0' })).toBe(false);
    expect(chainRequired({ coreVersion: '0.12.0', flag: '' })).toBe(false);
  });

  test('ships the exception chain when it is required', () => {
    if (!hasChain && !required) {
      console.warn(
        `[CoreExceptionChain] SKIPPED: @asenajs/asena ${coreVersion} has no exception chain. ` +
          `Run against a 0.13 core with ${REQUIRE_CHAIN_ENV}=1 (bun run test:core-chain) to execute it.`,
      );

      return;
    }

    expect({ coreVersion, hasChain }).toEqual({ coreVersion, hasChain: true });
  });
});

describe.skipIf(!hasChain)('core exception chain over the Hono adapter', () => {
  const app = hasChain ? defineApp() : (undefined as unknown as ReturnType<typeof defineApp>);

  let server: any;
  let adapter: HonoAdapter;
  let log: ReturnType<typeof capturingLogger>;
  let baseUrl: string;

  const bootWith = async (components: any[]) => {
    log = capturingLogger();
    [adapter] = createHonoAdapter(log.logger);

    server = await AsenaServerFactory.create({
      adapter: adapter as any,
      logger: log.logger,
      port: 0,
      components,
    });

    await server.start();
    baseUrl = `http://localhost:${server.httpServer?.port}`;
  };

  afterEach(async () => {
    await server?.stop(true);
    server = undefined;
    app.seen.length = 0;
  });

  describe('a thrown non-Error', () => {
    test('a string from a sync handler reaches @Catch() unchanged', async () => {
      await bootWith([app.NoteController, app.NumberThrowingMiddleware, app.CatchAllHandler]);

      const response = await fetch(`${baseUrl}/notes/text`);

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ caught: 'string' });
      expect(app.seen).toEqual(['text']);
    });

    test('an object from an async handler reaches @Catch() by identity', async () => {
      await bootWith([app.NoteController, app.NumberThrowingMiddleware, app.CatchAllHandler]);

      const response = await fetch(`${baseUrl}/notes/object`);

      expect(response.status).toBe(422);
      expect(app.seen).toHaveLength(1);
      expect(app.seen[0]).toBe(app.thrownObject);
    });

    test('a number from a route middleware reaches @Catch() unchanged', async () => {
      await bootWith([app.NoteController, app.NumberThrowingMiddleware, app.CatchAllHandler]);

      const response = await fetch(`${baseUrl}/notes/number`);

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ caught: 'number' });
      expect(app.seen).toEqual([42]);
    });

    test('a string a returned thenable rejects with reaches @Catch() unchanged', async () => {
      await bootWith([app.NoteController, app.NumberThrowingMiddleware, app.CatchAllHandler]);

      const response = await fetch(`${baseUrl}/notes/rejected`);

      expect(response.status).toBe(422);
      expect(app.seen).toEqual(['rejected']);
    });

    test('@Catch(Error) does not match it, so the adapter answers its default 500 and logs the value', async () => {
      await bootWith([app.NoteController, app.NumberThrowingMiddleware, app.ErrorHandler]);

      const response = await fetch(`${baseUrl}/notes/text`);

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Internal Server Error' });
      expect(app.seen).toEqual([]);
      expect(log.entries.filter((entry) => entry.level === 'error')).toHaveLength(1);
    });

    test('a @Catch() that declines hands the same value to Config.onError, then the adapter answers', async () => {
      await bootWith([app.NoteController, app.NumberThrowingMiddleware, app.CatchAllHandler, app.DecliningConfig]);

      const response = await fetch(`${baseUrl}/notes/declined`);

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Internal Server Error' });
      expect(app.seen).toEqual(['declined', ['onError', 'declined']]);
    });
  });

  test('a controller that returns a thenable answers with what it settles to', async () => {
    await bootWith([app.NoteController, app.NumberThrowingMiddleware, app.CatchAllHandler]);

    const response = await fetch(`${baseUrl}/notes/later`);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ later: true });
  });

  test('@Catch(Error) receives an HttpException thrown by a controller', async () => {
    await bootWith([app.NoteController, app.NumberThrowingMiddleware, app.ErrorHandler]);

    const response = await fetch(`${baseUrl}/notes/teapot`);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ caught: 'HttpException' });
  });

  test('a @NotFound() that declines leaves the adapter to answer its default 404', async () => {
    await bootWith([app.NoteController, app.NumberThrowingMiddleware, app.DecliningNotFoundHandler]);

    const response = await fetch(`${baseUrl}/nowhere`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not Found' });
    expect(app.seen).toEqual(['not-found']);
  });

  describe('under the console hook', () => {
    const globals = globalThis as Record<symbol, unknown>;
    const originalSend = process.send;
    const originalEnv = process.env.NODE_ENV;

    let records: any[];
    let bus: any;
    let hookCalls: number;

    const installHook = (attach: (context: any) => unknown = () => ({ detach: () => {} })) => {
      records = [];
      hookCalls = 0;
      process.send = (() => true) as typeof process.send;
      globals[DEVTOOLS_HOOK] = (context: any) => {
        hookCalls += 1;
        bus = context.bus;
        bus.subscribe((record: any) => records.push(record));

        return attach(context);
      };
    };

    const settled = async (count = 1) => {
      for (let i = 0; i < 50 && records.length < count; i++) {
        await Bun.sleep(1);
      }

      return records.map(({ method, path, status, steps, answeredBy }) => ({
        method,
        path,
        status,
        steps,
        answeredBy,
      }));
    };

    const servedFetch = async (components: any[]) => {
      const serve = spyOn(Bun, 'serve');

      try {
        await bootWith(components);

        return (serve.mock.calls[0][0] as { fetch: unknown }).fetch;
      } finally {
        serve.mockRestore();
      }
    };

    afterEach(() => {
      delete globals[DEVTOOLS_HOOK];
      process.send = originalSend;

      if (originalEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalEnv;

      bus = undefined;
    });

    test('a non-Error answered by @Catch() is recorded with the controller and the catch step', async () => {
      process.env.NODE_ENV = 'development';
      installHook();
      await bootWith([app.NoteController, app.NumberThrowingMiddleware, app.CatchAllHandler]);

      const response = await fetch(`${baseUrl}/notes/text`);

      expect(response.status).toBe(422);
      expect(await settled()).toEqual([
        {
          method: 'GET',
          path: '/notes/text',
          status: 422,
          steps: [
            { kind: 'controller', name: 'NoteController.text' },
            { kind: 'catch', name: 'CatchAllHandler.fallback' },
          ],
          answeredBy: { kind: 'catch', name: 'CatchAllHandler.fallback' },
        },
      ]);
    });

    test('a controller that returns a thenable is recorded with the status it settles to', async () => {
      process.env.NODE_ENV = 'development';
      installHook();
      await bootWith([app.NoteController, app.NumberThrowingMiddleware, app.CatchAllHandler]);

      const response = await fetch(`${baseUrl}/notes/later`);

      expect(response.status).toBe(202);
      expect(await settled()).toEqual([
        {
          method: 'GET',
          path: '/notes/later',
          status: 202,
          steps: [{ kind: 'controller', name: 'NoteController.later' }],
          answeredBy: { kind: 'controller', name: 'NoteController.later' },
        },
      ]);
    });

    test('NODE_ENV=production keeps the bus off: app.fetch is served itself and nothing is recorded', async () => {
      process.env.NODE_ENV = 'production';
      installHook();

      const served = await servedFetch([app.NoteController, app.NumberThrowingMiddleware, app.CatchAllHandler]);

      expect(served).toBe(adapter.app.fetch);
      expect(hookCalls).toBe(0);
      expect(log.entries.filter((entry) => entry.message.includes('devtools agent not attached'))).not.toHaveLength(0);

      const response = await fetch(`${baseUrl}/notes/text`);

      expect(response.status).toBe(422);
    });

    test('once core releases the bus the wrapped fetch opens no record', async () => {
      process.env.NODE_ENV = 'development';
      installHook(() => {
        throw new Error('agent failed');
      });

      const served = await servedFetch([app.NoteController, app.NumberThrowingMiddleware, app.CatchAllHandler]);

      expect(served).not.toBe(adapter.app.fetch);
      expect(bus.enabled).toBe(false);

      const open = spyOn(bus, 'open');

      try {
        const response = await fetch(`${baseUrl}/notes/text`);

        expect(response.status).toBe(422);
        expect(open).not.toHaveBeenCalled();
      } finally {
        open.mockRestore();
      }
    });
  });
});
