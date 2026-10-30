import { describe, expect, test } from 'bun:test';
import { AsenaServerFactory } from '@asenajs/asena';
import { Controller, Middleware } from '@asenajs/asena/decorators';
import { Post } from '@asenajs/asena/decorators/http';
import type { ServerLogger } from '@asenajs/asena/logger';
import { z } from 'zod';
import { Context, MiddlewareService, ValidationService } from '../index';
import { createHonoAdapter } from '../lib/utils/createHonoAdapter';

const logger: ServerLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  profile: () => {},
};

const trace: string[] = [];
let handlerCalls = 0;

class SubmissionContext extends Context.define({
  body: z.object({ amount: z.coerce.number().int(), title: z.string().default('untitled') }).superRefine(() => {
    trace.push('contract');
  }),
  query: z.object({ tag: z.union([z.string(), z.array(z.string())]).optional() }),
  params: z.object({ id: z.coerce.number().int() }),
  headers: z.object({ 'x-tenant': z.string().min(1) }),
}) {
  public get summary() {
    return `${this.input.params.id}:${this.input.body.amount}`;
  }
}

@Middleware()
class SubmissionMiddleware extends MiddlewareService {
  public async handle(context: Context, next: () => Promise<void>) {
    trace.push('route');
    if (context.req.path.startsWith('/submissions')) {
      expect(context).toBeInstanceOf(SubmissionContext);
      expect(() => (context as SubmissionContext).input).toThrow(/only available after route validation/);
      expect((await context.getArrayBuffer()).byteLength).toBeGreaterThan(0);
    }
    context.setValue('routeMarker', 'seen');
    await next();
  }
}

@Controller('/submissions')
class SubmissionController {
  @Post({ path: '/:id', middlewares: [SubmissionMiddleware] })
  public async submit(context: SubmissionContext) {
    handlerCalls++;
    trace.push('handler');
    expect(context).toBeInstanceOf(SubmissionContext);
    expect(Object.isFrozen(context.input)).toBe(true);
    expect(context.getValue<string>('routeMarker')).toBe('seen');
    return context.send({
      summary: context.summary,
      body: await context.getBody(),
      input: context.input,
      rawId: context.getParam('id'),
      rawTag: await context.getQueryAll('tag'),
    });
  }
}

async function boot(components: any[]) {
  const [adapter] = createHonoAdapter(logger);
  const server = await AsenaServerFactory.create({
    adapter,
    logger,
    port: 0,
    components,
    shutdown: { signals: false },
    keepAlive: false,
  });
  await server.start();
  return { server, url: `http://localhost:${server.httpServer!.port}` };
}

describe('Context.define over controller metadata', () => {
  test('validates five inputs, keeps raw getters, and uses the actual subclass', async () => {
    const { server, url } = await boot([SubmissionController, SubmissionMiddleware]);
    try {
      trace.length = 0;
      handlerCalls = 0;
      const response = await fetch(`${url}/submissions/7?tag=a&tag=b`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant': 'acme' },
        body: JSON.stringify({ amount: '12', extra: 'removed' }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        summary: '7:12',
        body: { amount: 12, title: 'untitled' },
        input: {
          body: { amount: 12, title: 'untitled' },
          query: { tag: ['a', 'b'] },
          params: { id: 7 },
          headers: { 'x-tenant': 'acme' },
        },
        rawId: '7',
        rawTag: ['a', 'b'],
      });
      expect(trace).toEqual(['route', 'contract', 'handler']);
      expect(handlerCalls).toBe(1);

      const invalid = await fetch(`${url}/submissions/7`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant': 'acme' },
        body: JSON.stringify({ amount: 'bad' }),
      });
      expect(invalid.status).toBe(400);
      expect(handlerCalls).toBe(1);

      const wrongType = await fetch(`${url}/submissions/7`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain', 'x-tenant': 'acme' },
        body: JSON.stringify({ amount: 12 }),
      });
      expect(wrongType.status).toBe(415);

      const malformed = await fetch(`${url}/submissions/7`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant': 'acme' },
        body: '{broken',
      });
      expect(malformed.status).toBe(400);
    } finally {
      await server.stop();
    }
  });

  test('rejects conflicting legacy validator at startup', async () => {
    @Middleware({ validator: true })
    class JsonValidator extends ValidationService {
      public json() {
        return z.object({ ok: z.boolean() });
      }
    }
    @Controller('/conflict')
    class ConflictController {
      @Post({ path: '/', validator: JsonValidator })
      public post(context: SubmissionContext) {
        return context.send({ ok: true });
      }
    }
    const [adapter] = createHonoAdapter(logger);
    const server = await AsenaServerFactory.create({
      adapter,
      logger,
      port: 0,
      components: [JsonValidator, ConflictController],
      shutdown: { signals: false },
      keepAlive: false,
    });
    try {
      await expect(server.start()).rejects.toThrow(/both.*validator/);
    } finally {
      await server.stop();
    }
  });
});

// Non-Zod Standard Schema exercises the structural contract and async validation.
const asyncSchema = {
  '~standard': {
    version: 1 as const,
    vendor: 'fixture',
    types: {} as { input: string; output: number | undefined },
    validate: async (value: unknown) =>
      value === 'none'
        ? { value: undefined }
        : typeof value === 'string' && /^\d+$/.test(value)
          ? { value: Number(value) }
          : { issues: [{ message: 'Expected digits', path: [{ key: 'value' }] }] },
  },
};

class AsyncContext extends Context.define({ body: asyncSchema }) {}

class FormContext extends Context.define({
  form: z.object({ tags: z.array(z.string()).min(2) }),
}) {}

@Controller('/forms')
class FormController {
  @Post('/')
  public async post(context: FormContext) {
    return context.send({ input: context.input, parsed: await context.getParseBody() });
  }
}

@Controller('/async')
class AsyncController {
  @Post('/')
  public async post(context: AsyncContext) {
    return context.send({ present: Object.hasOwn(context.input, 'body'), value: await context.getBody() });
  }
}

test('async Standard Schema preserves successful undefined output and normalizes issues', async () => {
  const { server, url } = await boot([AsyncController]);
  try {
    const none = await fetch(`${url}/async`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '"none"',
    });
    expect(none.status).toBe(200);
    expect(await none.json()).toEqual({ present: true });
    const failed = await fetch(`${url}/async`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '"oops"',
    });
    expect(failed.status).toBe(400);
    const body = (await failed.json()) as any;
    expect(body.issues?.[0]?.path).toEqual(['value']);
  } finally {
    await server.stop();
  }
});

test('form contracts retain repeated fields as arrays', async () => {
  const { server, url } = await boot([FormController]);
  try {
    const form = new FormData();
    form.append('tags', 'red');
    form.append('tags', 'blue');
    const response = await fetch(`${url}/forms`, { method: 'POST', body: form });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      input: { form: { tags: ['red', 'blue'] } },
      parsed: { tags: ['red', 'blue'] },
    });
  } finally {
    await server.stop();
  }
});

let acceptedValue = 'first';
let factoryCalls = 0;
let validationCalls = 0;

@Middleware({ validator: true })
class DynamicValidator extends ValidationService {
  public async json() {
    factoryCalls++;
    const expected = acceptedValue;
    return {
      schema: z.object({
        value: z.string().refine((value) => {
          validationCalls++;
          return value === expected;
        }),
      }),
      hook: async () => {
        trace.push('validation');
      },
    };
  }
}

@Controller('/cache')
class CacheController {
  @Post({ path: '/default', validator: DynamicValidator, middlewares: [SubmissionMiddleware] })
  public async cached(context: Context) {
    return context.send(await context.getBody());
  }

  @Post({ path: '/dynamic', validator: DynamicValidator, validatorCache: false })
  public async dynamic(context: Context) {
    return context.send(await context.getBody());
  }
}

test('metadata routes cache legacy factories by default and rebuild with validatorCache false', async () => {
  acceptedValue = 'first';
  factoryCalls = 0;
  validationCalls = 0;
  const { server, url } = await boot([DynamicValidator, SubmissionMiddleware, CacheController]);
  try {
    expect(factoryCalls).toBe(1);
    const send = (path: string, value: string) =>
      fetch(`${url}/cache/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value }),
      });
    trace.length = 0;
    expect((await send('default', 'first')).status).toBe(200);
    expect(trace).toEqual(['validation', 'route']);
    expect((await send('dynamic', 'first')).status).toBe(200);
    acceptedValue = 'second';
    expect((await send('default', 'first')).status).toBe(200);
    expect((await send('dynamic', 'second')).status).toBe(200);
    expect((await send('dynamic', 'first')).status).toBe(400);
    expect(factoryCalls).toBe(4);
    expect(validationCalls).toBe(5);
  } finally {
    await server.stop();
  }
});
