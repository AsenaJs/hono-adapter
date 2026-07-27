import { afterEach, describe, expect, test } from 'bun:test';
import { AsenaServerFactory } from '@asenajs/asena';
import { Controller, Middleware } from '@asenajs/asena/decorators';
import { Get, Post } from '@asenajs/asena/decorators/http';
import type { ServerLogger } from '@asenajs/asena/logger';
import { z } from 'zod';
import { createHonoAdapter } from '../lib/utils/createHonoAdapter';
import { MiddlewareService } from '../lib/defaults/MiddlewareService';
import { ValidationService } from '../lib/defaults/ValidationService';
import type { Context } from '../lib/defaults/Context';

/**
 * Twin of `ergenecore/test/undecoratedGuard.test.ts`.
 *
 * The rule lives in Asena core - `PrepareMiddlewareService` and `PrepareValidatorService` - so
 * in principle one adapter would do. It is worth both because the failure it prevents is an
 * authorization hole, because each adapter feeds those services a differently shaped middleware
 * value, and because each holds its own physical copy of `@asenajs/asena` in node_modules: a
 * core fix that is not synced into one of them shows up here and nowhere else.
 */

const silentLogger = (): ServerLogger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  profile: () => {},
});

const ran: string[] = [];

@Middleware()
class HonoReadGuard extends MiddlewareService {
  public async handle(_context: Context, next: () => Promise<void>) {
    ran.push('HonoReadGuard');
    await next();
  }
}

// @Middleware() deliberately omitted.
class HonoAdminGuard extends HonoReadGuard {
  public override async handle(_context: Context, next: () => Promise<void>) {
    ran.push('HonoAdminGuard');
    await next();
  }
}

@Controller('/route-level')
class HonoRouteLevelController {
  @Get({ path: '/danger', middlewares: [HonoAdminGuard] })
  public danger(context: Context) {
    return context.send({ ok: true });
  }
}

@Controller({ path: '/class-level', middlewares: [HonoAdminGuard] })
class HonoClassLevelController {
  @Get('/danger')
  public danger(context: Context) {
    return context.send({ ok: true });
  }
}

@Middleware({ validator: true })
class HonoPermissiveValidator extends ValidationService {
  public json() {
    return z.object({}).passthrough();
  }
}

class HonoStrictValidator extends HonoPermissiveValidator {
  public override json() {
    return z.object({ approvedBy: z.string() });
  }
}

@Controller('/validator')
class HonoValidatorController {
  @Post({ path: '/submit', validator: HonoStrictValidator })
  public submit(context: Context) {
    return context.send({ ok: true });
  }
}

describe('an undecorated subclass referenced from a route (hono)', () => {
  let server: any;

  afterEach(async () => {
    await server?.stop(true);
    server = undefined;
  });

  const bootAndProbe = async (components: any[], probe: { path: string; init?: RequestInit }) => {
    ran.length = 0;

    const [adapter] = createHonoAdapter(silentLogger());

    let failure: Error | undefined;

    try {
      server = await AsenaServerFactory.create({
        adapter: adapter as any,
        logger: silentLogger(),
        port: 0,
        components,
      });

      await server.start();
    } catch (error) {
      failure = error as Error;
    }

    if (failure) return { failure, response: undefined as Response | undefined };

    const port = (server as any).httpServer?.port;
    const response = await fetch(`http://localhost:${port}${probe.path}`, probe.init);

    return { failure, response };
  };

  test('route-level middlewares: the base guard cannot serve the route', async () => {
    const { failure, response } = await bootAndProbe([HonoReadGuard, HonoRouteLevelController], {
      path: '/route-level/danger',
    });

    if (!failure) {
      throw new Error(
        `boot succeeded - /route-level/danger answered ${response!.status}, guarded by [${ran.join(', ')}]`,
      );
    }

    expect(failure.message).toMatch(/HonoAdminGuard/);
    expect(failure.message).toMatch(/not a component/);
    expect(ran).toEqual([]);
  });

  test('class-level @Controller middlewares: same rule', async () => {
    const { failure, response } = await bootAndProbe([HonoReadGuard, HonoClassLevelController], {
      path: '/class-level/danger',
    });

    if (!failure) {
      throw new Error(
        `boot succeeded - /class-level/danger answered ${response!.status}, guarded by [${ran.join(', ')}]`,
      );
    }

    expect(failure.message).toMatch(/HonoAdminGuard/);
    expect(ran).toEqual([]);
  });

  test('validator: the permissive base cannot validate for the strict subclass', async () => {
    const { failure, response } = await bootAndProbe([HonoPermissiveValidator, HonoValidatorController], {
      path: '/validator/submit',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anything: true }),
      },
    });

    if (!failure) {
      throw new Error(
        `boot succeeded - /validator/submit answered ${response!.status} for a body the declared ` +
          'validator rejects',
      );
    }

    expect(failure.message).toMatch(/HonoStrictValidator/);
    expect(failure.message).toMatch(/not a component/);
  });

  test('a decorated subclass is fine, and its own handler is the one that runs', async () => {
    @Middleware()
    class HonoDecoratedAdminGuard extends HonoReadGuard {
      public override async handle(_context: Context, next: () => Promise<void>) {
        ran.push('HonoDecoratedAdminGuard');
        await next();
      }
    }

    @Controller('/decorated')
    class HonoDecoratedController {
      @Get({ path: '/danger', middlewares: [HonoDecoratedAdminGuard] })
      public danger(context: Context) {
        return context.send({ ok: true });
      }
    }

    const { failure, response } = await bootAndProbe(
      [HonoReadGuard, HonoDecoratedAdminGuard, HonoDecoratedController],
      { path: '/decorated/danger' },
    );

    expect(failure).toBeUndefined();
    expect(response!.status).toBe(200);
    expect(ran).toEqual(['HonoDecoratedAdminGuard']);
  });
});
