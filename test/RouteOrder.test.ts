import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestApp, silentLogger, type TestApp } from '@asenajs/asena/test';
import { Controller, Middleware } from '@asenajs/asena/decorators';
import { Get, Post } from '@asenajs/asena/decorators/http';
import { z } from 'zod';
import { createHonoAdapter, MiddlewareService, ValidationService } from '../index';
import type { Context } from '../index';

/**
 * Route middlewares must run before the route's validator, matching ergenecore:
 * global middlewares → route middlewares → validator → handler. In the other order an
 * invalid body is answered 400 without the route middleware ever running, so an auth or
 * rate-limit guard never sees the request.
 */
const order: string[] = [];

@Middleware()
class RouteMw extends MiddlewareService {
  public async handle(_ctx: Context, next: () => Promise<void>) {
    order.push('route-middleware');
    await next();
  }
}

@Middleware({ validator: true })
class BodyValidator extends ValidationService {
  public json() {
    return z.object({ name: z.string().min(3) });
  }
}

@Middleware({ validator: true })
class QueryValidator extends ValidationService {
  public query() {
    return z.object({ page: z.coerce.number().int().min(1) });
  }
}

@Controller('/order')
class OrderController {
  @Post({ path: '/', validator: BodyValidator, middlewares: [RouteMw] })
  public async create(ctx: Context) {
    order.push('handler');
    return ctx.send({ ok: true });
  }

  @Get({ path: '/search', validator: QueryValidator })
  public async search(ctx: Context) {
    return ctx.send({ ok: true });
  }
}

describe('route middlewares run before validators', () => {
  let app: TestApp;

  beforeAll(async () => {
    const [adapter] = createHonoAdapter({ logger: silentLogger });

    app = await createTestApp({
      adapter,
      components: [OrderController, RouteMw, BodyValidator, QueryValidator],
    });
  });

  afterAll(async () => {
    await app?.stop();
  });

  test('valid body: route middleware, then handler', async () => {
    order.length = 0;

    await app
      .post('/order', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'abcd' }),
      })
      .expectStatus(200)
      .expectJson({ ok: true });

    expect(order).toEqual(['route-middleware', 'handler']);
  });

  test('invalid body: route middleware ran, handler did not', async () => {
    order.length = 0;

    await app
      .post('/order', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'a' }),
      })
      .expectStatus(400);

    expect(order).toEqual(['route-middleware']);
  });

  test('a route with a validator and no route middlewares still validates', async () => {
    await app.get('/order/search').expectStatus(400);
    await app.get('/order/search?page=2').expectStatus(200).expectJson({ ok: true });
  });
});
