import { afterEach, describe, expect, test } from 'bun:test';
import { AsenaServerFactory } from '@asenajs/asena';
import { Controller, Middleware, Service } from '@asenajs/asena/decorators';
import { Delete, Get } from '@asenajs/asena/decorators/http';
import { Inject } from '@asenajs/asena/decorators/ioc';
import type { ServerLogger } from '@asenajs/asena/logger';
import { createHonoAdapter } from '../lib/utils/createHonoAdapter';
import { MiddlewareService } from '../lib/defaults/MiddlewareService';
import type { Context } from '../lib/defaults/Context';

// End-to-end counterpart to Asena's RouteInheritance suite. The original report found these
// bugs by running the app, not by reading it - so at least one layer has to actually answer
// an HTTP request over the real adapter.

const silentLogger = (): ServerLogger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  profile: () => {},
});

@Service('HonoProbeService')
class HonoProbeService {
  public status() {
    return 'up';
  }
}

@Middleware()
class HonoStampMiddleware extends MiddlewareService {
  public async handle(context: Context, next: () => Promise<void>) {
    context.setValue('stamped', true);
    await next();
  }
}

abstract class HonoHealthControllerBase {
  @Inject(HonoProbeService)
  protected probeService: HonoProbeService;

  @Get('/live')
  public live(context: Context) {
    return context.send({ probe: 'live', status: this.probeService.status() });
  }

  @Get({ path: '/guarded', middlewares: [HonoStampMiddleware] })
  public guarded(context: Context) {
    return context.send({ stamped: context.getValue('stamped') === true });
  }
}

@Controller('/probe')
class HonoProbeController extends HonoHealthControllerBase {
  @Get('/own')
  public own(context: Context) {
    return context.send({ probe: 'own' });
  }
}

// The interaction the changeset advertises but nothing covered: routes declared on a *base
// class*, sharing one base path, each carrying a *different* route-level middleware. That is
// exactly the precondition the removed grouping optimisation keyed on, and one inherited
// middleware cannot detect a swap - two can. `ran` is asserted by identity.
const ran: string[] = [];

@Middleware()
class HonoReadGuard extends MiddlewareService {
  public async handle(_context: Context, next: () => Promise<void>) {
    ran.push('read-guard');
    await next();
  }
}

@Middleware()
class HonoAdminGuard extends MiddlewareService {
  public async handle(_context: Context, next: () => Promise<void>) {
    ran.push('admin-guard');
    await next();
  }
}

@Middleware()
class HonoTenantGuard extends MiddlewareService {
  public async handle(context: Context, next: () => Promise<void>) {
    context.setValue('tenant', 'acme');
    await next();
  }
}

abstract class HonoItemControllerBase {
  @Get({ path: '/:id', middlewares: [HonoReadGuard] })
  public read(context: Context) {
    return context.send({ action: 'read' });
  }

  @Delete({ path: '/:id', middlewares: [HonoAdminGuard] })
  public remove(context: Context) {
    return context.send({ action: 'delete' });
  }
}

@Controller({ path: '/guarded-base', middlewares: [HonoTenantGuard] })
abstract class HonoGuardedControllerBase {
  @Get('/whoami')
  public whoami(context: Context) {
    return context.send({ tenant: context.getValue('tenant') ?? null });
  }
}

@Controller('/items')
class HonoItemController extends HonoItemControllerBase {}

// Declares no middlewares of its own. @Controller writes the key unconditionally - an empty
// array - so reading it own-only lets this class shadow its base's guard while still
// inheriting the base's route: a reachable endpoint with its auth quietly gone.
@Controller('/tenant')
class HonoTenantController extends HonoGuardedControllerBase {}

describe('route inheritance over the Hono adapter', () => {
  let server: any;

  afterEach(async () => {
    await server?.stop(true);
    server = undefined;
  });

  const bootWith = async (components: any[]) => {
    const [adapter] = createHonoAdapter(silentLogger());

    server = await AsenaServerFactory.create({
      adapter: adapter as any,
      logger: silentLogger(),
      port: 0,
      components,
    });

    await server.start();

    return (server as any).httpServer?.port;
  };

  const boot = () => bootWith([HonoProbeService, HonoStampMiddleware, HonoProbeController]);

  test('answers a route declared on the base class', async () => {
    const port = await boot();

    const response = await fetch(`http://localhost:${port}/probe/live`);
    const body = await response.json();

    expect(response.status).toBe(200);
    // The handler body lives on the base class but resolves the subclass's injected service
    expect(body).toEqual({ probe: 'live', status: 'up' });
  });

  test('answers the subclass own route too', async () => {
    const port = await boot();

    const response = await fetch(`http://localhost:${port}/probe/own`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ probe: 'own' });
  });

  test('runs the middleware declared on an inherited route', async () => {
    const port = await boot();

    const response = await fetch(`http://localhost:${port}/probe/guarded`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stamped: true });
  });

  test('two inherited routes on one base path keep their own middlewares', async () => {
    const port = await bootWith([HonoReadGuard, HonoAdminGuard, HonoItemController]);

    ran.length = 0;

    const remove = await fetch(`http://localhost:${port}/items/42`, { method: 'DELETE' });

    expect(remove.status).toBe(200);
    expect(await remove.json()).toEqual({ action: 'delete' });
    // Identity, not count: ['read-guard'] and ['read-guard', 'admin-guard'] both have a
    // plausible length and both are an authorization hole.
    expect(ran).toEqual(['admin-guard']);

    ran.length = 0;

    const read = await fetch(`http://localhost:${port}/items/42`);

    expect(read.status).toBe(200);
    expect(ran).toEqual(['read-guard']);
  });

  test("a subclass inherits its base's controller-level middleware", async () => {
    const port = await bootWith([HonoTenantGuard, HonoTenantController]);

    const response = await fetch(`http://localhost:${port}/tenant/whoami`);

    expect(response.status).toBe(200);
    // Scoped to the subclass's own prefix, and still applied - the route registers either way,
    // so a null tenant here is a live endpoint whose guard silently stopped running.
    expect(await response.json()).toEqual({ tenant: 'acme' });
  });
});
