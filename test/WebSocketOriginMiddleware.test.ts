import { describe, expect, it, afterEach, mock } from 'bun:test';
import type { Server } from 'bun';
import { AsenaWebSocketService } from '@asenajs/asena/web-socket';
import type { BaseMiddleware } from '@asenajs/asena/adapter';
import { CorsMiddleware, WebSocketOriginMiddleware } from '../lib/defaults';
import type { Context as HonoAdapterContext } from '../lib/defaults';
import { createTestAdapter, startTestServer } from './utils/testHelpers';

class CountingWebSocketService extends AsenaWebSocketService<any> {
  public opened = 0;

  protected async onOpen(_ws: any) {
    this.opened++;
  }
}

// A browser attaches cookies to a cross-site handshake, so by the time a cookie-based auth
// middleware looks at the request the session is already authenticated. CorsMiddleware does not
// help - it sets response headers, and the upgrade happens anyway.
describe('WebSocketOriginMiddleware', () => {
  let server: Server<any> | undefined;

  afterEach(() => {
    if (server) {
      server.stop(true);
      server = undefined;
    }
  });

  const start = async (middlewares: any[]) => {
    const { adapter } = createTestAdapter();
    const service = new CountingWebSocketService();

    service.namespace = 'chat';

    adapter.registerWebsocketRoute({
      path: 'chat',
      middlewares: middlewares as BaseMiddleware<HonoAdapterContext>[],
      websocketService: service as any,
    });

    const { server: started, baseUrl, port } = await startTestServer(adapter);

    server = started;

    return { baseUrl, port, service };
  };

  const handshake = (baseUrl: string, headers: Record<string, string> = {}) =>
    fetch(`${baseUrl}/chat`, {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': btoa('0123456789abcdef'),
        ...headers,
      },
    });

  const openSocket = (port: number, headers?: Record<string, string>): Promise<'open' | 'error' | 'timeout'> =>
    new Promise((resolve) => {
      // @ts-ignore - Bun accepts per-handshake headers
      const ws = new WebSocket(`ws://localhost:${port}/chat`, headers ? { headers } : undefined);

      ws.onopen = () => {
        ws.close();
        resolve('open');
      };
      ws.onerror = () => resolve('error');
      setTimeout(() => resolve('timeout'), 3000);
    });

  const allowedOrigins = ['https://app.example'];

  it('should reject a cookie-carrying handshake from a disallowed origin', async () => {
    const { baseUrl, service } = await start([new WebSocketOriginMiddleware({ allowedOrigins })]);

    const response = await handshake(baseUrl, {
      Origin: 'https://evil.example',
      Cookie: 'session=ok',
    });

    expect(response.status).toBe(403);
    // The upgrade must not have happened: a socket that opens is already authenticated
    expect(service.opened).toBe(0);
  });

  it('should fail a WebSocket client from a disallowed origin', async () => {
    const { port, service } = await start([new WebSocketOriginMiddleware({ allowedOrigins })]);

    expect(await openSocket(port, { Origin: 'https://evil.example', Cookie: 'session=ok' })).toBe('error');
    expect(service.opened).toBe(0);
  });

  it('should upgrade a handshake from an allowed origin', async () => {
    const { port, service } = await start([new WebSocketOriginMiddleware({ allowedOrigins })]);

    expect(await openSocket(port, { Origin: 'https://app.example' })).toBe('open');
    expect(service.opened).toBe(1);
  });

  it('should reject a handshake without an Origin by default', async () => {
    const { baseUrl, port, service } = await start([new WebSocketOriginMiddleware({ allowedOrigins })]);

    expect((await handshake(baseUrl)).status).toBe(403);
    expect(await openSocket(port)).toBe('error');
    expect(service.opened).toBe(0);
  });

  it('should accept a handshake without an Origin when allowMissingOrigin is set', async () => {
    const { port, service } = await start([
      new WebSocketOriginMiddleware({ allowedOrigins, allowMissingOrigin: true }),
    ]);

    // Also the proof that neither Bun client sends an Origin of its own - if one did, this
    // handshake would carry a disallowed origin and be rejected.
    expect(await openSocket(port)).toBe('open');
    expect(service.opened).toBe(1);
  });

  it('should support a predicate for wildcard subdomains', async () => {
    const { baseUrl, port, service } = await start([
      new WebSocketOriginMiddleware({ allowedOrigins: (origin) => origin.endsWith('.example') }),
    ]);

    expect(await openSocket(port, { Origin: 'https://a.example' })).toBe('open');
    expect((await handshake(baseUrl, { Origin: 'https://a.evil' })).status).toBe(403);
    expect(service.opened).toBe(1);
  });

  it('should document that CorsMiddleware alone does not block a disallowed origin', async () => {
    const { port, service } = await start([new CorsMiddleware({ origin: ['https://app.example'] })]);

    // The reason this middleware exists: CORS is a browser-side response policy, and the
    // handshake it was supposed to stop upgrades anyway.
    expect(await openSocket(port, { Origin: 'https://evil.example', Cookie: 'session=ok' })).toBe('open');
    expect(service.opened).toBe(1);
  });

  it('should short-circuit before the middlewares listed after it', async () => {
    let authCalls = 0;

    const countingAuth: BaseMiddleware<HonoAdapterContext> = {
      handle: mock(async (_ctx: HonoAdapterContext, next: () => Promise<void>) => {
        authCalls++;
        await next();

        return true;
      }),
      override: false,
    };

    const { baseUrl, service } = await start([new WebSocketOriginMiddleware({ allowedOrigins }), countingAuth]);

    expect((await handshake(baseUrl, { Origin: 'https://evil.example' })).status).toBe(403);
    // Order is the point: an auth middleware that runs first would already have trusted the
    // cross-site session's cookie.
    expect(authCalls).toBe(0);
    expect(service.opened).toBe(0);
  });
});
