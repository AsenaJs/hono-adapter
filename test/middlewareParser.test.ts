import { describe, expect, it, mock } from 'bun:test';
import { middlewareParser } from '../lib/utils/middlewareParser';
import { HonoContextWrapper } from '../lib/HonoContextWrapper';
import type { BaseMiddleware } from '@asenajs/asena/adapter';
import type { Context as HonoAdapterContext } from '../lib/defaults';

describe('middlewareParser', () => {
  const createMockContext = () => {
    const store = new Map();

    return {
      req: {
        header: mock(() => ({})),
        param: mock(() => 'test'),
        json: mock(() => Promise.resolve({})),
        query: mock(() => 'test'),
        queries: mock(() => []),
      },
      res: {
        headers: {
          append: mock(() => {}),
        },
      },
      text: mock(() => new Response('text')),
      json: mock(() => new Response('{}')),
      html: mock(() => new Response('<html></html>')),
      redirect: mock(() => new Response()),
      get: mock((key: string) => store.get(key)),
      set: mock((key: string, value: any) => store.set(key, value)),
    };
  };

  const createMockNext = () => mock(async () => {});

  describe('Basic Middleware Parsing', () => {
    it('should parse a single middleware', () => {
      const middleware: BaseMiddleware<HonoAdapterContext> = {
        handle: mock(async (_context, next) => {
          await next();
        }),
        override: false,
      };

      const result = middlewareParser([middleware]);

      expect(result).toBeArray();
      expect(result).toHaveLength(1);
      expect(typeof result[0]).toBe('function');
    });

    it('should parse multiple middlewares', () => {
      const middlewares: BaseMiddleware<HonoAdapterContext>[] = [
        {
          handle: mock(async (_context, next) => await next()),
          override: false,
        },
        {
          handle: mock(async (_context, next) => await next()),
          override: false,
        },
        {
          handle: mock(async (_context, next) => await next()),
          override: false,
        },
      ];

      const result = middlewareParser(middlewares);

      expect(result).toHaveLength(3);
    });

    it('should return empty array for empty middlewares', () => {
      const result = middlewareParser([]);

      expect(result).toBeArray();
      expect(result).toHaveLength(0);
    });
  });

  describe('Normal Middleware Execution', () => {
    it('should execute middleware with context wrapper', async () => {
      const handleMock = mock(async (context, next) => {
        expect(context).toBeInstanceOf(HonoContextWrapper);
        await next();
      });

      const middleware: BaseMiddleware<HonoAdapterContext> = {
        handle: handleMock,
        override: false,
      };

      const [parsedMiddleware] = middlewareParser([middleware]);
      const mockContext = createMockContext();
      const mockNext = createMockNext();

      await parsedMiddleware(mockContext as any, mockNext);

      expect(handleMock).toHaveBeenCalled();
      expect(mockContext.set).toHaveBeenCalledWith('_asenaContextWrapper', expect.any(HonoContextWrapper));
    });

    it('should call next when middleware completes', async () => {
      const middleware: BaseMiddleware<HonoAdapterContext> = {
        handle: mock(async (_context, next) => {
          await next();
        }),
        override: false,
      };

      const [parsedMiddleware] = middlewareParser([middleware]);
      const mockContext = createMockContext();
      const mockNext = createMockNext();

      await parsedMiddleware(mockContext as any, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle middleware without explicit next() call', async () => {
      const middleware: BaseMiddleware<HonoAdapterContext> = {
        handle: mock(async (context) => {
          // Doesn't call next()
          context.setValue('executed', true);
        }),
        override: false,
      };

      const [parsedMiddleware] = middlewareParser([middleware]);
      const mockContext = createMockContext();
      const mockNext = createMockNext();

      await parsedMiddleware(mockContext as any, mockNext);

      expect(middleware.handle).toHaveBeenCalled();
    });
  });

  describe('Context Wrapper Reuse', () => {
    it('should create new context wrapper when not exists', async () => {
      const middleware: BaseMiddleware<HonoAdapterContext> = {
        handle: mock(async (context, next) => {
          expect(context).toBeInstanceOf(HonoContextWrapper);
          await next();
        }),
        override: false,
      };

      const [parsedMiddleware] = middlewareParser([middleware]);
      const mockContext = createMockContext();
      const mockNext = createMockNext();

      await parsedMiddleware(mockContext as any, mockNext);

      expect(mockContext.set).toHaveBeenCalledWith('_asenaContextWrapper', expect.any(HonoContextWrapper));
      expect(mockContext.get).toHaveBeenCalledWith('_asenaContextWrapper');
    });

    it('should reuse existing context wrapper', async () => {
      const existingWrapper = new HonoContextWrapper(createMockContext() as any);
      let receivedWrapper: any;

      const middleware: BaseMiddleware<HonoAdapterContext> = {
        handle: mock(async (context, next) => {
          receivedWrapper = context;
          await next();
        }),
        override: false,
      };

      const [parsedMiddleware] = middlewareParser([middleware]);
      const mockContext = createMockContext();

      // Pre-set the wrapper
      mockContext.get = mock((key: string) => {
        if (key === '_asenaContextWrapper') return existingWrapper;

        return undefined;
      });

      const mockNext = createMockNext();

      await parsedMiddleware(mockContext as any, mockNext);

      expect(receivedWrapper).toBe(existingWrapper);
      // Should not create a new one
      expect(mockContext.set).not.toHaveBeenCalled();
    });
  });

  describe('Override Middleware', () => {
    it('should pass raw Hono context to override middleware', async () => {
      let receivedContext: any;
      let receivedNext: any;

      const middleware: BaseMiddleware<HonoAdapterContext> = {
        handle: mock(async (context, next) => {
          receivedContext = context;
          receivedNext = next;
          await next();
        }),
        override: true,
      };

      const [parsedMiddleware] = middlewareParser([middleware]);
      const mockContext = createMockContext();
      const mockNext = createMockNext();

      await parsedMiddleware(mockContext as any, mockNext);

      expect(receivedContext).toBe(mockContext);
      expect(receivedNext).toBe(mockNext);
      expect(receivedContext).not.toBeInstanceOf(HonoContextWrapper);
    });

    it('should not create context wrapper for override middleware', async () => {
      const middleware: BaseMiddleware<HonoAdapterContext> = {
        handle: mock(async (_context, next) => {
          await next();
        }),
        override: true,
      };

      const [parsedMiddleware] = middlewareParser([middleware]);
      const mockContext = createMockContext();
      const mockNext = createMockNext();

      await parsedMiddleware(mockContext as any, mockNext);

      // Should not create wrapper
      expect(mockContext.set).not.toHaveBeenCalledWith('_asenaContextWrapper', expect.anything());
    });
  });

  describe('Pipeline Control', () => {
    it('should stop pipeline when middleware returns false', async () => {
      const middleware: BaseMiddleware<HonoAdapterContext> = {
        handle: mock(async (_context, _next) => {
          return false;
        }),
        override: false,
      };

      const [parsedMiddleware] = middlewareParser([middleware]);
      const mockContext = createMockContext();
      const mockNext = createMockNext();

      await parsedMiddleware(mockContext as any, mockNext);

      expect(middleware.handle).toHaveBeenCalled();
      // next should not be called when middleware returns false
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should continue pipeline when middleware returns true', async () => {
      const middleware: BaseMiddleware<HonoAdapterContext> = {
        handle: mock(async (_context, next) => {
          await next();
          return true;
        }),
        override: false,
      };

      const [parsedMiddleware] = middlewareParser([middleware]);
      const mockContext = createMockContext();
      const mockNext = createMockNext();

      await parsedMiddleware(mockContext as any, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should continue pipeline when middleware returns undefined', async () => {
      const middleware: BaseMiddleware<HonoAdapterContext> = {
        handle: mock(async (_context, next) => {
          await next();
          // Returns undefined implicitly
        }),
        override: false,
      };

      const [parsedMiddleware] = middlewareParser([middleware]);
      const mockContext = createMockContext();
      const mockNext = createMockNext();

      await parsedMiddleware(mockContext as any, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should propagate errors from middleware', async () => {
      const testError = new Error('Middleware error');
      const middleware: BaseMiddleware<HonoAdapterContext> = {
        handle: mock(async () => {
          throw testError;
        }),
        override: false,
      };

      const [parsedMiddleware] = middlewareParser([middleware]);
      const mockContext = createMockContext();
      const mockNext = createMockNext();

      expect(parsedMiddleware(mockContext as any, mockNext)).rejects.toThrow('Middleware error');
    });

    it('should handle errors in override middleware', async () => {
      const testError = new Error('Override middleware error');
      const middleware: BaseMiddleware<HonoAdapterContext> = {
        handle: mock(async () => {
          throw testError;
        }),
        override: true,
      };

      const [parsedMiddleware] = middlewareParser([middleware]);
      const mockContext = createMockContext();
      const mockNext = createMockNext();

      expect(parsedMiddleware(mockContext as any, mockNext)).rejects.toThrow('Override middleware error');
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle middleware chain correctly', async () => {
      const executionOrder: number[] = [];

      const middlewares: BaseMiddleware<HonoAdapterContext>[] = [
        {
          handle: mock(async (_context, next) => {
            executionOrder.push(1);
            await next();
            executionOrder.push(4);
          }),
          override: false,
        },
        {
          handle: mock(async (_context, next) => {
            executionOrder.push(2);
            await next();
            executionOrder.push(3);
          }),
          override: false,
        },
      ];

      const parsedMiddlewares = middlewareParser(middlewares);
      const mockContext = createMockContext();

      // Simulate middleware chain execution
      await parsedMiddlewares[0](mockContext as any, async () => {
        // eslint-disable-next-line max-nested-callbacks
        await parsedMiddlewares[1](mockContext as any, async () => {
          // Final handler
        });
      });

      expect(executionOrder).toEqual([1, 2, 3, 4]);
    });

    it('should handle mix of override and normal middlewares', async () => {
      const normalMiddleware: BaseMiddleware<HonoAdapterContext> = {
        handle: mock(async (context, next) => {
          expect(context).toBeInstanceOf(HonoContextWrapper);
          await next();
        }),
        override: false,
      };

      const overrideMiddleware: BaseMiddleware<HonoAdapterContext> = {
        handle: mock(async (context, next) => {
          expect(context).not.toBeInstanceOf(HonoContextWrapper);
          await next();
        }),
        override: true,
      };

      const parsedMiddlewares = middlewareParser([normalMiddleware, overrideMiddleware]);

      expect(parsedMiddlewares).toHaveLength(2);

      const mockContext = createMockContext();
      const mockNext = createMockNext();

      await parsedMiddlewares[0](mockContext as any, mockNext);
      await parsedMiddlewares[1](mockContext as any, mockNext);

      expect(normalMiddleware.handle).toHaveBeenCalled();
      expect(overrideMiddleware.handle).toHaveBeenCalled();
    });

    it('should maintain context data across middlewares', async () => {
      const middleware1: BaseMiddleware<HonoAdapterContext> = {
        handle: mock(async (context, next) => {
          context.setValue('testKey', 'testValue');
          await next();
        }),
        override: false,
      };

      const middleware2: BaseMiddleware<HonoAdapterContext> = {
        handle: mock(async (context, next) => {
          const value = context.getValue('testKey');

          expect(value).toBe('testValue');
          await next();
        }),
        override: false,
      };

      const parsedMiddlewares = middlewareParser([middleware1, middleware2]);
      const mockContext = createMockContext();

      await parsedMiddlewares[0](mockContext as any, async () => {
        // eslint-disable-next-line max-nested-callbacks
        await parsedMiddlewares[1](mockContext as any, async () => {});
      });

      expect(middleware1.handle).toHaveBeenCalled();
      expect(middleware2.handle).toHaveBeenCalled();
    });
  });
});
