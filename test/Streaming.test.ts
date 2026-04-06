import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { HonoAdapter } from '../lib/HonoAdapter';
import { HonoWebsocketAdapter } from '../lib/HonoWebsocketAdapter';
import type { ServerLogger } from '@asenajs/asena/logger';
import { HttpMethod } from '@asenajs/asena/web-types';
import type { Context } from '../lib/defaults/Context';

const createMockLogger = (): ServerLogger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  // @ts-ignore
  debug: () => {},
});

describe('Hono Streaming Tests', () => {
  let adapter: HonoAdapter;
  let server: any;
  let baseUrl: string;

  beforeAll(async () => {
    const logger = createMockLogger();
    const wsAdapter = new HonoWebsocketAdapter(logger);

    adapter = new HonoAdapter(logger, wsAdapter);
    adapter.setPort(0);

    await adapter.registerRoute({
      method: HttpMethod.GET,
      path: '/stream',
      middlewares: [],
      handler: (context: Context) => {
        return context.stream(async (stream) => {
          await stream.write('hello ');
          await stream.write('world');
        });
      },
      staticServe: null,
      validator: null,
    });

    await adapter.registerRoute({
      method: HttpMethod.GET,
      path: '/sse',
      middlewares: [],
      handler: (context: Context) => {
        return context.streamSSE(async (stream) => {
          await stream.writeSSE({ data: 'event1', event: 'update', id: '1' });
          await stream.writeSSE({ data: 'event2', event: 'update', id: '2' });
        });
      },
      staticServe: null,
      validator: null,
    });

    await adapter.registerRoute({
      method: HttpMethod.GET,
      path: '/text',
      middlewares: [],
      handler: (context: Context) => {
        return context.streamText(async (stream) => {
          await stream.writeln('line1');
          await stream.writeln('line2');
        });
      },
      staticServe: null,
      validator: null,
    });

    await adapter.registerRoute({
      method: HttpMethod.GET,
      path: '/sse-error',
      middlewares: [],
      handler: (context: Context) => {
        return context.streamSSE(
          async () => {
            throw new Error('stream failed');
          },
          async (error, stream) => {
            await stream.writeSSE({ data: error.message, event: 'error' });
          },
        );
      },
      staticServe: null,
      validator: null,
    });

    await adapter.registerRoute({
      method: HttpMethod.GET,
      path: '/sse-json',
      middlewares: [],
      handler: (context: Context) => {
        return context.streamSSE(async (stream) => {
          for (let i = 0; i < 3; i++) {
            await stream.writeSSE({
              data: JSON.stringify({ count: i }),
              event: 'tick',
              id: String(i),
            });
          }
        });
      },
      staticServe: null,
      validator: null,
    });

    await adapter.registerRoute({
      method: HttpMethod.GET,
      path: '/stream-pipe',
      middlewares: [],
      handler: (context: Context) => {
        return context.stream(async (stream) => {
          const source = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('piped content'));
              controller.close();
            },
          });

          await stream.pipe(source);
        });
      },
      staticServe: null,
      validator: null,
    });

    adapter.onError((error, context) => {
      return context.send({ error: error.message }, 500);
    });

    server = await adapter.start();
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(async () => {
    if (server) {
      server.stop();
    }
  });

  describe('Generic stream()', () => {
    it('should stream data', async () => {
      const response = await fetch(`${baseUrl}/stream`);
      const text = await response.text();

      expect(response.status).toBe(200);
      expect(text).toBe('hello world');
    });

    it('should pipe a ReadableStream', async () => {
      const response = await fetch(`${baseUrl}/stream-pipe`);
      const text = await response.text();

      expect(text).toBe('piped content');
    });
  });

  describe('SSE streamSSE()', () => {
    it('should set correct SSE headers', async () => {
      const response = await fetch(`${baseUrl}/sse`);

      expect(response.headers.get('content-type')).toBe('text/event-stream');
      expect(response.headers.get('cache-control')).toBe('no-cache');
    });

    it('should stream SSE formatted messages', async () => {
      const response = await fetch(`${baseUrl}/sse`);
      const text = await response.text();

      expect(text).toContain('event: update');
      expect(text).toContain('data: event1');
      expect(text).toContain('id: 1');
      expect(text).toContain('data: event2');
      expect(text).toContain('id: 2');
    });

    it('should stream multiple JSON SSE events', async () => {
      const response = await fetch(`${baseUrl}/sse-json`);
      const text = await response.text();

      expect(text).toContain('event: tick');
      expect(text).toContain('data: {"count":0}');
      expect(text).toContain('data: {"count":1}');
      expect(text).toContain('data: {"count":2}');
    });

    it('should call onError when stream callback throws', async () => {
      const response = await fetch(`${baseUrl}/sse-error`);
      const text = await response.text();

      expect(text).toContain('event: error');
      expect(text).toContain('data: stream failed');
    });
  });

  describe('Text streamText()', () => {
    it('should set text/plain content-type', async () => {
      const response = await fetch(`${baseUrl}/text`);

      expect(response.headers.get('content-type')).toContain('text/plain');
    });

    it('should stream text lines', async () => {
      const response = await fetch(`${baseUrl}/text`);
      const text = await response.text();

      expect(text).toBe('line1\nline2\n');
    });
  });
});