import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createTestApp, silentLogger, type TestApp } from '@asenajs/asena/test';
import { Controller, Middleware } from '@asenajs/asena/decorators';
import { Get, Post } from '@asenajs/asena/decorators/http';
import { z } from 'zod';
import { createHonoAdapter, MiddlewareService, ValidationService } from '../index';
import type { Context } from '../index';

@Middleware()
class Guard extends MiddlewareService {
  public async handle(context: Context, next: () => Promise<void>): Promise<any> {
    if (context.req.header('x-token') !== 'ok') {
      return new Response('Unauthorized', { status: 401 });
    }

    return await next();
  }
}

@Middleware({ validator: true })
class BodyValidator extends ValidationService {
  public json() {
    return z.object({ name: z.string().min(3) });
  }
}

@Controller({ path: '/', middlewares: [Guard] })
class RootGuarded {
  @Get('/secret')
  public secret(context: Context) {
    return context.send({ from: 'root-secret' });
  }

  @Get('/')
  public root(context: Context) {
    return context.send({ from: 'root' });
  }

  @Post({ path: '/submit', validator: BodyValidator })
  public submit(context: Context) {
    return context.send({ from: 'submit' });
  }
}

@Controller({ path: '', middlewares: [Guard] })
class EmptyGuarded {
  @Get('/empty-secret')
  public emptySecret(context: Context) {
    return context.send({ from: 'empty-secret' });
  }
}

@Controller({ path: '/admin/', middlewares: [Guard] })
class AdminSlashGuarded {
  @Get('/secret')
  public secret(context: Context) {
    return context.send({ from: 'admin-secret' });
  }

  @Get('/')
  public index(context: Context) {
    return context.send({ from: 'admin-root' });
  }
}

@Controller({ path: '/api', middlewares: [Guard] })
class ApiGuarded {
  @Get('/secret')
  public secret(context: Context) {
    return context.send({ from: 'api-secret' });
  }
}

@Controller('/api/open')
class ApiOpen {
  @Get('/x')
  public x(context: Context) {
    return context.send({ from: 'open' });
  }
}

@Controller('/')
class RootRouteLevel {
  @Get({ path: '/route-guarded', middlewares: [Guard] })
  public routeGuarded(context: Context) {
    return context.send({ from: 'route-guarded' });
  }
}

// '/admin/' is deliberately absent: this adapter normalises a trailing slash away at
// registration, so `@Controller('/admin/')` + `@Get('/')` is reachable only as '/admin'.
const guardedPaths = ['/secret', '/', '/empty-secret', '/admin/secret', '/admin', '/api/secret'];

// Needs core >= 0.12.0 (controller middlewares attached per route). The installed core is the
// published one, so this runs only when node_modules/@asenajs/asena is linked to a built core.
describe.skipIf(process.env.ASENA_LINKED_CORE !== '1')('controller middlewares scope to their own routes', () => {
  let app: TestApp;

  beforeAll(async () => {
    const [adapter] = createHonoAdapter({ logger: silentLogger });

    app = await createTestApp({
      adapter,
      components: [
        Guard,
        BodyValidator,
        RootGuarded,
        EmptyGuarded,
        AdminSlashGuarded,
        ApiGuarded,
        ApiOpen,
        RootRouteLevel,
      ],
    });
  });

  afterAll(async () => {
    await app?.stop();
  });

  const status = async (path: string, token?: string): Promise<number> => {
    const response = await fetch(`${app.baseUrl}${path}`, {
      headers: token ? { 'x-token': token } : {},
    });

    return response.status;
  };

  it.each(guardedPaths)('should run the controller guard on %s', async (path) => {
    expect(await status(path)).toBe(401);
  });

  it.each(guardedPaths)('should let %s through once the guard is satisfied', async (path) => {
    expect(await status(path, 'ok')).toBe(200);
  });

  it('should not guard an unrelated controller mounted under the same prefix', async () => {
    // The old `/api/*` pattern was a path scope, not a controller scope, so this route inherited
    // an authorization decision its author never wrote.
    expect(await status('/api/open/x')).toBe(200);
  });

  it('should not run the controller guard on an unmatched path under its prefix', async () => {
    // The guard is attached to the controller's routes, so a 404 is answered as a 404. Under the
    // old `/prefix/*` pattern this path was answered 401 by a guard belonging to a route that
    // does not exist at this spelling.
    expect(await status('/admin/')).toBe(404);
    expect(await status('/admin/', 'ok')).toBe(404);
  });

  it('should still run a route-level middleware on a root controller', async () => {
    expect(await status('/route-guarded')).toBe(401);
    expect(await status('/route-guarded', 'ok')).toBe(200);
  });

  it('should reject an invalid body with 401, not 400, when the controller guard denies', async () => {
    // Only true once route middlewares run before validators (hono-adapter >= 5.0.0): otherwise
    // an unauthenticated request is answered 400 and the controller guard never sees it.
    const response = await fetch(`${app.baseUrl}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'a' }),
    });

    expect(response.status).toBe(401);
  });

  it('should still validate the body once the controller guard passes', async () => {
    const response = await fetch(`${app.baseUrl}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-token': 'ok' },
      body: JSON.stringify({ name: 'a' }),
    });

    expect(response.status).toBe(400);
  });
});
