import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import type { Server } from 'bun';
import type { Context as HonoAdapterContext } from '../lib/defaults';
// AsenaContext declares `html: (data: string) => …` while every adapter implements
// `html(data, statusOrOptions?)`. These two cases exercise the second argument, so they are
// typed against the concrete wrapper. The core-interface gap is flagged in the report.
import type { HonoContextWrapper } from '../lib/HonoContextWrapper';
import { HttpMethod } from '@asenajs/asena/web-types';
import { createTestAdapter, startTestServer, registerRoute } from './utils/testHelpers';

describe('HonoContextWrapper', () => {
  let server: Server<any> | undefined;

  afterEach(async () => {
    if (server) {
      server.stop(true);
      server = undefined;
    }
  });

  // ─── Body Parsing ─────────────────────────────────────────────────

  describe('Body Parsing', () => {
    it('getBody() should parse JSON body', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        method: HttpMethod.POST,
        path: '/body',
        handler: async (ctx) => {
          const body = await ctx.getBody<{ name: string; age: number }>();
          return ctx.send(body);
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/body`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice', age: 30 }),
      });

      const data = await res.json();
      expect(data.name).toBe('Alice');
      expect(data.age).toBe(30);
    });

    it('getParseBody() should parse form-encoded body', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        method: HttpMethod.POST,
        path: '/form',
        handler: async (ctx) => {
          const body = await ctx.getParseBody();
          return ctx.send(body);
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const formData = new URLSearchParams();
      formData.append('field1', 'value1');
      formData.append('field2', 'value2');

      const res = await fetch(`${baseUrl}/form`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      });

      const data = await res.json();
      expect(data.field1).toBe('value1');
      expect(data.field2).toBe('value2');
    });

    it('getFormData() should return FormData', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        method: HttpMethod.POST,
        path: '/formdata',
        handler: async (ctx) => {
          const fd = await ctx.getFormData();
          return ctx.send({
            name: fd.get('name'),
            file: fd.get('file') ? 'exists' : 'missing',
          });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const fd = new FormData();
      fd.append('name', 'test');
      fd.append('file', new Blob(['content']), 'test.txt');

      const res = await fetch(`${baseUrl}/formdata`, { method: 'POST', body: fd });
      const data = await res.json();
      expect(data.name).toBe('test');
      expect(data.file).toBe('exists');
    });

    it('getArrayBuffer() should return ArrayBuffer', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        method: HttpMethod.POST,
        path: '/arraybuffer',
        handler: async (ctx) => {
          const buf = await ctx.getArrayBuffer();
          return ctx.send({ byteLength: buf.byteLength });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/arraybuffer`, {
        method: 'POST',
        body: new Uint8Array([1, 2, 3, 4, 5]),
      });

      const data = await res.json();
      expect(data.byteLength).toBe(5);
    });

    it('getBlob() should return Blob', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        method: HttpMethod.POST,
        path: '/blob',
        handler: async (ctx) => {
          const blob = await ctx.getBlob();
          return ctx.send({ size: blob.size, type: blob.type });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/blob`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'hello blob',
      });

      const data = await res.json();
      expect(data.size).toBe(10);
    });
  });

  // ─── Query Parameters ─────────────────────────────────────────────

  describe('Query Parameters', () => {
    it('getQuery() should return single query value', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/q',
        handler: async (ctx) => {
          const val = await ctx.getQuery('key');
          return ctx.send({ key: val });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/q?key=hello`);
      expect((await res.json()).key).toBe('hello');
    });

    it('getQueryAll() should return array of values for repeated key', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/qa',
        handler: async (ctx) => {
          const vals = await ctx.getQueryAll('tag');
          return ctx.send({ tags: vals });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/qa?tag=a&tag=b&tag=c`);
      const data = await res.json();
      expect(data.tags).toEqual(['a', 'b', 'c']);
    });

    it('getAllQueries() should return record with singles as string and multiples as array', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/all-q',
        handler: (ctx) => {
          const all = ctx.getAllQueries();
          return ctx.send(all);
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/all-q?name=alice&tag=a&tag=b`);
      const data = await res.json();
      expect(data.name).toBe('alice');
      expect(data.tag).toEqual(['a', 'b']);
    });
  });

  // ─── Route Parameters ─────────────────────────────────────────────

  describe('Route Parameters', () => {
    it('getParam() should return route parameter value', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/users/:userId',
        handler: (ctx) => {
          return ctx.send({ userId: ctx.getParam('userId') });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/users/42`);
      expect((await res.json()).userId).toBe('42');
    });
  });

  // ─── Request Properties ───────────────────────────────────────────

  describe('Request Properties', () => {
    it('headers getter should return request headers', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/headers',
        handler: (ctx) => {
          const h = ctx.headers;
          return ctx.send({
            auth: h['authorization'],
            custom: h['x-custom'],
          });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/headers`, {
        headers: {
          Authorization: 'Bearer token123',
          'X-Custom': 'myvalue',
        },
      });

      const data = await res.json();
      expect(data.auth).toBe('Bearer token123');
      expect(data.custom).toBe('myvalue');
    });

    it('getRequestIp() should return client IP', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/ip',
        handler: (ctx) => {
          const ip = ctx.getRequestIp();
          return ctx.send({ ip, hasIp: ip !== null });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/ip`);
      const data = await res.json();
      // localhost connection should have an IP (127.0.0.1 or ::1)
      expect(data.hasIp).toBe(true);
      expect(data.ip).toBeTruthy();
    });

    it('getRequestIp() should cache the result', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/ip-cached',
        handler: (ctx) => {
          const ip1 = ctx.getRequestIp();
          const ip2 = ctx.getRequestIp();
          return ctx.send({ same: ip1 === ip2 });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/ip-cached`);
      expect((await res.json()).same).toBe(true);
    });

    it('req and res getters should be accessible', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/raw',
        handler: (ctx) => {
          return ctx.send({
            hasReq: ctx.req !== undefined,
            method: ctx.req.method,
          });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/raw`);
      const data = await res.json();
      expect(data.hasReq).toBe(true);
      expect(data.method).toBe('GET');
    });
  });

  // ─── Response — send() ────────────────────────────────────────────

  describe('Response — send()', () => {
    it('should send string as text/plain', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/text',
        handler: (ctx) => ctx.send('hello text'),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/text`);
      expect(res.headers.get('content-type')).toContain('text/plain');
      expect(await res.text()).toBe('hello text');
    });

    it('should send object as JSON', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/json',
        handler: (ctx) => ctx.send({ key: 'value' }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/json`);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toEqual({ key: 'value' });
    });

    it('should send with custom status code (number)', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        method: HttpMethod.POST,
        path: '/created',
        handler: (ctx) => ctx.send({ id: 1 }, 201),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/created`, { method: 'POST' });
      expect(res.status).toBe(201);
    });

    it('should send string with custom status code', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/no-content',
        handler: (ctx) => ctx.send('', 204),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/no-content`);
      expect(res.status).toBe(204);
    });

    it('should send with custom status and headers (SendOptions)', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/opts',
        handler: (ctx) => ctx.send({ ok: true }, { status: 201, headers: { 'X-Custom': 'val' } }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/opts`);
      expect(res.status).toBe(201);
      expect(res.headers.get('X-Custom')).toBe('val');
    });
  });

  // ─── Response — html() ────────────────────────────────────────────

  describe('Response — html()', () => {
    it('should return text/html content', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/page',
        handler: (ctx) => ctx.html('<h1>Title</h1>'),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/page`);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(await res.text()).toBe('<h1>Title</h1>');
    });

    it('should return html with custom status', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/not-found',
        handler: (ctx: HonoContextWrapper) => ctx.html('<h1>404</h1>', 404),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/not-found`);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('<h1>404</h1>');
    });

    it('should return html with SendOptions', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/html-opts',
        handler: (ctx: HonoContextWrapper) => ctx.html('<p>Hi</p>', { status: 200, headers: { 'X-Page': 'home' } }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/html-opts`);
      expect(res.headers.get('X-Page')).toBe('home');
      expect(await res.text()).toBe('<p>Hi</p>');
    });
  });

  // ─── Response Headers ─────────────────────────────────────────────

  describe('Response Headers', () => {
    it('setResponseHeader() should add header to response', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/custom-header',
        handler: (ctx) => {
          ctx.setResponseHeader('X-Request-Id', 'abc-123');
          ctx.setResponseHeader('X-Trace', 'trace-456');
          return ctx.send({ ok: true });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/custom-header`);
      expect(res.headers.get('X-Request-Id')).toBe('abc-123');
      expect(res.headers.get('X-Trace')).toBe('trace-456');
    });
  });

  // ─── Redirect ─────────────────────────────────────────────────────

  describe('Redirect', () => {
    it('should return 302 redirect', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/old-page',
        handler: (ctx) => ctx.redirect('/new-page'),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/old-page`, { redirect: 'manual' });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/new-page');
    });
  });

  // ─── Cookies ──────────────────────────────────────────────────────

  describe('Cookies', () => {
    it('setCookie() and getCookie() round-trip', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/set-cookie',
        handler: async (ctx) => {
          await ctx.setCookie('session', 'abc123');
          return ctx.send({ set: true });
        },
      });

      await registerRoute(adapter, {
        path: '/get-cookie',
        handler: async (ctx) => {
          const val = await ctx.getCookie('session');
          return ctx.send({ session: val });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      // Set cookie
      const setRes = await fetch(`${baseUrl}/set-cookie`);
      const setCookieHeader = setRes.headers.get('set-cookie');
      expect(setCookieHeader).toContain('session=abc123');

      // Get cookie
      const getRes = await fetch(`${baseUrl}/get-cookie`, {
        headers: { Cookie: 'session=abc123' },
      });
      const data = await getRes.json();
      expect(data.session).toBe('abc123');
    });

    it('deleteCookie() should set expired cookie', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/delete-cookie',
        handler: async (ctx) => {
          await ctx.deleteCookie('session');
          return ctx.send({ deleted: true });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/delete-cookie`);
      // Hono sets max-age=0 to delete cookies
      expect(res.headers.get('set-cookie')).toContain('session=');
      expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    });

    it('setCookie() with options (httpOnly, secure)', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/cookie-opts',
        handler: async (ctx) => {
          await ctx.setCookie('token', 'xyz', {
            extraOptions: {
              httpOnly: true,
              secure: true,
              path: '/',
              maxAge: 3600,
            },
          });
          return ctx.send({ ok: true });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/cookie-opts`);
      const header = res.headers.get('set-cookie');
      expect(header).toContain('token=xyz');
      expect(header).toContain('HttpOnly');
      expect(header).toContain('Secure');
      expect(header).toContain('Max-Age=3600');
    });
  });

  // ─── Context Values ───────────────────────────────────────────────

  describe('Context Values', () => {
    it('setValue/getValue round-trip within request', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/values',
        handler: (ctx) => {
          ctx.setValue('myKey' as any, { data: 42 });
          const val = ctx.getValue('myKey' as any);
          return ctx.send({ val });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/values`);
      expect((await res.json()).val).toEqual({ data: 42 });
    });

    it('setWebSocketValue/getWebSocketValue round-trip', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/ws-values',
        handler: (ctx) => {
          ctx.setWebSocketValue({ userId: 'ws-user-1' });
          const val = ctx.getWebSocketValue();
          return ctx.send({ val });
        },
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/ws-values`);
      expect((await res.json()).val).toEqual({ userId: 'ws-user-1' });
    });
  });

  // ─── Streaming ────────────────────────────────────────────────────

  describe('Streaming', () => {
    it('stream() should write chunks', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/stream',
        handler: (ctx) =>
          ctx.stream(async (stream) => {
            await stream.write('chunk1');
            await stream.write('chunk2');
            await stream.close();
          }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/stream`);
      const text = await res.text();
      expect(text).toContain('chunk1');
      expect(text).toContain('chunk2');
    });

    it('streamSSE() should format as SSE events', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/sse',
        handler: (ctx) =>
          ctx.streamSSE(async (stream) => {
            await stream.writeSSE({ data: 'hello', event: 'message', id: '1' });
            await stream.close();
          }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/sse`);
      expect(res.headers.get('content-type')).toContain('text/event-stream');

      const text = await res.text();
      expect(text).toContain('event: message');
      expect(text).toContain('data: hello');
      expect(text).toContain('id: 1');
    });

    it('streamText() should stream text content', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/stream-text',
        handler: (ctx) =>
          ctx.streamText(async (stream) => {
            await stream.writeln('line 1');
            await stream.writeln('line 2');
            await stream.close();
          }),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/stream-text`);
      expect(res.headers.get('content-type')).toContain('text/plain');

      const text = await res.text();
      expect(text).toContain('line 1');
      expect(text).toContain('line 2');
    });

    it('stream() should call onError on error', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/stream-error',
        handler: (ctx) =>
          ctx.stream(
            async () => {
              throw new Error('stream failed');
            },
            async (_error, stream) => {
              await stream.write('error handled');
              await stream.close();
            },
          ),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/stream-error`);
      const text = await res.text();
      expect(text).toContain('error handled');
    });

    it('streamSSE() should call onError on error', async () => {
      const { adapter } = createTestAdapter();

      await registerRoute(adapter, {
        path: '/sse-error',
        handler: (ctx) =>
          ctx.streamSSE(
            async () => {
              throw new Error('sse failed');
            },
            async (_error, stream) => {
              await stream.writeSSE({ data: 'error event', event: 'error' });
              await stream.close();
            },
          ),
      });

      const { server: s, baseUrl } = await startTestServer(adapter);
      server = s;

      const res = await fetch(`${baseUrl}/sse-error`);
      const text = await res.text();
      expect(text).toContain('error event');
    });
  });
});
