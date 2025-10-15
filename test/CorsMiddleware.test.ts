import { describe, expect, it, mock } from 'bun:test';
import { CorsMiddleware } from '../lib/middlewares/CorsMiddleware';
import type { AsenaContext } from '@asenajs/asena/adapter';
import type { HonoRequest } from 'hono';

describe('CorsMiddleware', () => {
  const createMockContext = (origin?: string, method = 'GET') => {
    const headers = new Map<string, string>();

    const mockContext = {
      req: {
        method,
        header: mock((name: string) => {
          if (name === 'Origin') return origin;

          return undefined;
        }),
      } as HonoRequest,
      context: {
        header: mock((key: string, value: string) => {
          headers.set(key, value);
        }),
      },
      _headers: headers,
    };

    return mockContext as any;
  };

  describe('Constructor and Default Options', () => {
    it('should create middleware with default options', () => {
      const middleware = new CorsMiddleware();

      expect(middleware).toBeDefined();
    });

    it('should create middleware with custom options', () => {
      const middleware = new CorsMiddleware({
        origin: ['https://example.com'],
        methods: ['GET', 'POST'],
        credentials: true,
        maxAge: 3600,
      });

      expect(middleware).toBeDefined();
    });
  });

  describe('No Origin Header (Skip CORS)', () => {
    it('should skip CORS processing when no Origin header present', async () => {
      const middleware = new CorsMiddleware();
      const context = createMockContext(); // no origin
      const next = mock(() => Promise.resolve());

      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(next).toHaveBeenCalled();
      expect(context.context.header).not.toHaveBeenCalled();
    });
  });

  describe('Origin Validation - Wildcard (*)', () => {
    it('should allow all origins with wildcard setting', async () => {
      const middleware = new CorsMiddleware({ origin: '*' });
      const context = createMockContext('https://example.com');
      const next = mock(() => Promise.resolve());

      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(next).toHaveBeenCalled();
      expect(context.context.header).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    });

    it('should allow any origin with wildcard', async () => {
      const middleware = new CorsMiddleware({ origin: '*' });
      const context = createMockContext('https://unknown-site.com');
      const next = mock(() => Promise.resolve());

      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(next).toHaveBeenCalled();
      expect(context.context.header).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    });
  });

  describe('Origin Validation - Array of Origins', () => {
    it('should allow requests from allowed origin', async () => {
      const middleware = new CorsMiddleware({
        origin: ['https://example.com', 'https://app.example.com'],
      });
      const context = createMockContext('https://example.com');
      const next = mock(() => Promise.resolve());

      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(next).toHaveBeenCalled();
      expect(context.context.header).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://example.com');
    });

    it('should block requests from non-allowed origin', async () => {
      const middleware = new CorsMiddleware({
        origin: ['https://example.com'],
      });
      const context = createMockContext('https://evil.com');
      const next = mock(() => Promise.resolve());

      const response = await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(next).not.toHaveBeenCalled();
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(403);

      const text = await response.text();

      expect(text).toBe('CORS: Origin not allowed');
    });
  });

  describe('Origin Validation - Function', () => {
    it('should use function to validate origin (allowed)', async () => {
      const middleware = new CorsMiddleware({
        origin: (origin: string) => origin.endsWith('.example.com'),
      });
      const context = createMockContext('https://app.example.com');
      const next = mock(() => Promise.resolve());

      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(next).toHaveBeenCalled();
      expect(context.context.header).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://app.example.com');
    });

    it('should use function to validate origin (blocked)', async () => {
      const middleware = new CorsMiddleware({
        origin: (origin: string) => origin.endsWith('.example.com'),
      });
      const context = createMockContext('https://evil.com');
      const next = mock(() => Promise.resolve());

      const response = await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(next).not.toHaveBeenCalled();
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(403);
    });
  });

  describe('Preflight OPTIONS Request', () => {
    it('should handle preflight OPTIONS request with default headers', async () => {
      const middleware = new CorsMiddleware();
      const context = createMockContext('https://example.com', 'OPTIONS');
      const next = mock(() => Promise.resolve());

      const response = await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(next).not.toHaveBeenCalled();
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(204);

      const headers = response.headers;

      expect(headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(headers.get('Access-Control-Allow-Methods')).toContain('GET');
      expect(headers.get('Access-Control-Allow-Methods')).toContain('POST');
      expect(headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
      expect(headers.get('Access-Control-Max-Age')).toBe('86400');
    });

    it('should handle preflight with custom methods and headers', async () => {
      const middleware = new CorsMiddleware({
        origin: '*',
        methods: ['GET', 'POST', 'DELETE'],
        allowedHeaders: ['Content-Type', 'X-Custom-Header'],
        maxAge: 3600,
      });
      const context = createMockContext('https://example.com', 'OPTIONS');
      const next = mock(() => Promise.resolve());

      const response = await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(response.status).toBe(204);

      const headers = response.headers;

      expect(headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, DELETE');
      expect(headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, X-Custom-Header');
      expect(headers.get('Access-Control-Max-Age')).toBe('3600');
    });

    it('should include credentials header in preflight when enabled', async () => {
      const middleware = new CorsMiddleware({
        origin: 'https://example.com',
        credentials: true,
      });
      const context = createMockContext('https://example.com', 'OPTIONS');
      const next = mock(() => Promise.resolve());

      const response = await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(response.status).toBe(204);

      const headers = response.headers;

      expect(headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });
  });

  describe('Actual Requests (Non-OPTIONS)', () => {
    it('should set CORS headers for GET request', async () => {
      const middleware = new CorsMiddleware({ origin: '*' });
      const context = createMockContext('https://example.com', 'GET');
      const next = mock(() => Promise.resolve());

      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(next).toHaveBeenCalled();
      expect(context.context.header).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    });

    it('should set CORS headers for POST request', async () => {
      const middleware = new CorsMiddleware({ origin: '*' });
      const context = createMockContext('https://example.com', 'POST');
      const next = mock(() => Promise.resolve());

      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(next).toHaveBeenCalled();
      expect(context.context.header).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    });

    it('should include credentials header when enabled', async () => {
      const middleware = new CorsMiddleware({
        origin: 'https://example.com',
        credentials: true,
      });
      const context = createMockContext('https://example.com', 'GET');
      const next = mock(() => Promise.resolve());

      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(next).toHaveBeenCalled();
      expect(context.context.header).toHaveBeenCalledWith('Access-Control-Allow-Credentials', 'true');
    });

    it('should include exposed headers when configured', async () => {
      const middleware = new CorsMiddleware({
        origin: '*',
        exposedHeaders: ['X-Custom-Header', 'X-Request-Id'],
      });
      const context = createMockContext('https://example.com', 'GET');
      const next = mock(() => Promise.resolve());

      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(next).toHaveBeenCalled();
      expect(context.context.header).toHaveBeenCalledWith(
        'Access-Control-Expose-Headers',
        'X-Custom-Header, X-Request-Id',
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty exposedHeaders array', async () => {
      const middleware = new CorsMiddleware({
        origin: '*',
        exposedHeaders: [],
      });
      const context = createMockContext('https://example.com', 'GET');
      const next = mock(() => Promise.resolve());

      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(next).toHaveBeenCalled();
      // Should not call header() for empty exposedHeaders
      const calls = (context.context.header as any).mock.calls;
      const exposedHeadersCalls = calls.filter((call: any[]) => call[0] === 'Access-Control-Expose-Headers');

      expect(exposedHeadersCalls.length).toBe(0);
    });

    it('should handle multiple origins in array', async () => {
      const origins = [
        'https://example.com',
        'https://app.example.com',
        'https://api.example.com',
        'https://cdn.example.com',
      ];
      const middleware = new CorsMiddleware({ origin: origins });

      // Test all origins
      for (const testOrigin of origins) {
        const context = createMockContext(testOrigin, 'GET');
        const next = mock(() => Promise.resolve());

        await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

        expect(next).toHaveBeenCalled();
        expect(context.context.header).toHaveBeenCalledWith('Access-Control-Allow-Origin', testOrigin);
      }
    });

    it('should not set credentials header when credentials is false', async () => {
      const middleware = new CorsMiddleware({
        origin: '*',
        credentials: false,
      });
      const context = createMockContext('https://example.com', 'GET');
      const next = mock(() => Promise.resolve());

      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(next).toHaveBeenCalled();

      const calls = (context.context.header as any).mock.calls;
      const credentialsCalls = calls.filter((call: any[]) => call[0] === 'Access-Control-Allow-Credentials');

      expect(credentialsCalls.length).toBe(0);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle request with all CORS features enabled', async () => {
      const middleware = new CorsMiddleware({
        origin: ['https://example.com'],
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Custom'],
        exposedHeaders: ['X-Request-Id', 'X-Total-Count'],
        credentials: true,
        maxAge: 7200,
      });

      const context = createMockContext('https://example.com', 'GET');
      const next = mock(() => Promise.resolve());

      await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

      expect(next).toHaveBeenCalled();
      expect(context.context.header).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://example.com');
      expect(context.context.header).toHaveBeenCalledWith('Access-Control-Allow-Credentials', 'true');
      expect(context.context.header).toHaveBeenCalledWith(
        'Access-Control-Expose-Headers',
        'X-Request-Id, X-Total-Count',
      );
    });

    it('should handle complex origin validation function', async () => {
      const middleware = new CorsMiddleware({
        origin: (origin: string) => {
          // Allow all subdomains of example.com and localhost
          return origin.includes('example.com') || origin.includes('localhost');
        },
      });

      // Test allowed origins
      const allowedOrigins = [
        'https://example.com',
        'https://app.example.com',
        'https://api.example.com',
        'http://localhost:3000',
      ];

      for (const testOrigin of allowedOrigins) {
        const context = createMockContext(testOrigin, 'GET');
        const next = mock(() => Promise.resolve());

        await middleware.handle(context as AsenaContext<HonoRequest, Response>, next);

        expect(next).toHaveBeenCalled();
      }

      // Test blocked origin
      const blockedContext = createMockContext('https://evil.com', 'GET');
      const blockedNext = mock(() => Promise.resolve());
      const response = await middleware.handle(blockedContext as AsenaContext<HonoRequest, Response>, blockedNext);

      expect(blockedNext).not.toHaveBeenCalled();
      expect(response.status).toBe(403);
    });
  });
});
