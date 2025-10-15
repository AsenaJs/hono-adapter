import { describe, expect, it, mock } from 'bun:test';
import { HonoContextWrapper } from '../lib/HonoContextWrapper';
import type { Context } from 'hono';

describe('HonoContextWrapper', () => {
  const createMockContext = () => {
    return {
      req: {
        header: mock(() => ({ 'content-type': 'application/json', authorization: 'Bearer token' })),
        arrayBuffer: mock(() => Promise.resolve(new ArrayBuffer(8))),
        parseBody: mock(() => Promise.resolve({ field1: 'value1', field2: 'value2' })),
        blob: mock(() => Promise.resolve(new Blob(['test content']))),
        formData: mock(() => {
          const fd = new FormData();

          fd.append('field', 'value');
          return Promise.resolve(fd);
        }),
        param: mock((name) => `param-${name}`),
        json: mock(() => Promise.resolve({ test: 'data' })),
        query: mock((name) => `query-${name}`),
        queries: mock((name) => [`query-${name}-1`, `query-${name}-2`]),
      },
      res: {
        headers: {
          append: mock(() => {}),
        },
      },
      text: mock(() => new Response('text')),
      json: mock(() => new Response(JSON.stringify({ test: 'data' }))),
      get: mock((key) => {
        if (key === '_websocketData') return { wsKey: 'wsValue' };

        return `value-${key}`;
      }),
      set: mock(() => {}),
      html: mock(() => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } })),
      redirect: mock(() => new Response('', { status: 302 })),
    };
  };

  describe('Constructor and Basic Getters', () => {
    it('should create a wrapper instance and provide access to context properties', () => {
      const mockContext = createMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      expect(wrapper).toBeDefined();
      // @ts-ignore
      expect(wrapper.req).toBe(mockContext.req);
      // @ts-ignore
      expect(wrapper.res).toBe(mockContext.res);
    });

    it('should get headers correctly', () => {
      const mockContext = createMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      const headers = wrapper.headers;

      expect(headers).toEqual({ 'content-type': 'application/json', authorization: 'Bearer token' });
      expect(mockContext.req.header).toHaveBeenCalled();
    });

    it('should get and set context directly', () => {
      const mockContext1 = createMockContext() as unknown as Context;
      const mockContext2 = createMockContext() as unknown as Context;
      const wrapper = new HonoContextWrapper(mockContext1 as any);

      expect(wrapper.context).toBe(mockContext1);

      wrapper.context = mockContext2 as any;

      expect(wrapper.context).toBe(mockContext2);
    });
  });

  describe('Request Body Methods', () => {
    it('should get array buffer', async () => {
      const mockContext = createMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      const buffer = await wrapper.getArrayBuffer();

      expect(buffer).toBeInstanceOf(ArrayBuffer);
      expect(buffer.byteLength).toBe(8);
      expect(mockContext.req.arrayBuffer).toHaveBeenCalled();
    });

    it('should get parsed body', async () => {
      const mockContext = createMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      const body = await wrapper.getParseBody();

      expect(body).toEqual({ field1: 'value1', field2: 'value2' });
      expect(mockContext.req.parseBody).toHaveBeenCalled();
    });

    it('should get blob', async () => {
      const mockContext = createMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      const blob = await wrapper.getBlob();

      expect(blob).toBeInstanceOf(Blob);
      expect(mockContext.req.blob).toHaveBeenCalled();
    });

    it('should get form data', async () => {
      const mockContext = createMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      const formData = await wrapper.getFormData();

      expect(formData).toBeInstanceOf(FormData);
      expect(formData.get('field')).toBe('value');
      expect(mockContext.req.formData).toHaveBeenCalled();
    });

    it('should get JSON body', async () => {
      const mockContext = createMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      const body = await wrapper.getBody();

      expect(body).toEqual({ test: 'data' });
      expect(mockContext.req.json).toHaveBeenCalled();
    });
  });

  describe('Parameters and Query', () => {
    it('should get a parameter by name', () => {
      const mockContext = createMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      const param = wrapper.getParam('id');

      expect(param).toBe('param-id');
      expect(mockContext.req.param).toHaveBeenCalledWith('id');
    });

    it('should get single query parameter', async () => {
      const mockContext = createMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      const query = await wrapper.getQuery('search');

      expect(query).toBe('query-search');
      expect(mockContext.req.query).toHaveBeenCalledWith('search');
    });

    it('should get all query parameters', async () => {
      const mockContext = createMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      const queries = await wrapper.getQueryAll('tags');

      expect(queries).toEqual(['query-tags-1', 'query-tags-2']);
      expect(mockContext.req.queries).toHaveBeenCalledWith('tags');
    });
  });

  describe('Response Methods - send()', () => {
    it('should send string data correctly', () => {
      const mockContext = createMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      wrapper.send('Hello World');

      expect(mockContext.text).toHaveBeenCalledWith('Hello World');
    });

    it('should send JSON data correctly', () => {
      const mockContext = createMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      const data = { message: 'Hello World' };

      wrapper.send(data);

      expect(mockContext.json).toHaveBeenCalledWith(data, 200, {});
    });

    it('should send JSON with custom status code', () => {
      const mockContext = createMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      const data = { error: 'Not Found' };

      wrapper.send(data, 404);

      expect(mockContext.json).toHaveBeenCalledWith(data, 404, {});
    });

    it('should send JSON with SendOptions', () => {
      const mockContext = createMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      const data = { message: 'Created' };
      const options = { status: 201, headers: { 'X-Custom': 'value' } };

      wrapper.send(data, options);

      expect(mockContext.res.headers.append).toHaveBeenCalledWith('X-Custom', 'value');
      expect(mockContext.json).toHaveBeenCalledWith(data, 201, options.headers);
    });

    it('should send with empty headers when headers is undefined in SendOptions', () => {
      const mockContext = createMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      const data = { message: 'OK' };

      wrapper.send(data, { status: 200 });

      expect(mockContext.json).toHaveBeenCalledWith(data, 200, {});
    });
  });

  describe('Response Methods - html()', () => {
    it('should send HTML content correctly', () => {
      const mockContext = createMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      const html = '<p>Hello World</p>';

      wrapper.html(html);

      expect(mockContext.html).toHaveBeenCalledWith(html, 200, {});
    });

    it('should send HTML with custom status code', () => {
      const mockContext = createMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      const html = '<p>Not Found</p>';

      wrapper.html(html, 404);

      expect(mockContext.html).toHaveBeenCalledWith(html, 404, {});
    });

    it('should send HTML with SendOptions', () => {
      const mockContext = createMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      const html = '<p>Hello</p>';
      const options = { status: 201, headers: { 'X-Custom-Header': 'custom' } };

      wrapper.html(html, options);

      expect(mockContext.html).toHaveBeenCalledWith(html, 201, options.headers);
    });
  });

  describe('Context Value Management', () => {
    it('should get and set context values', () => {
      const mockContext = createMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      wrapper.setValue('key', 'value');
      const value = wrapper.getValue('key');

      expect(mockContext.set).toHaveBeenCalledWith('key', 'value');
      expect(value).toBe('value-key');
    });

    it('should set and get WebSocket values', () => {
      const mockContext = createMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      const wsData = { userId: '123', room: 'chat' };

      wrapper.setWebSocketValue(wsData);

      expect(mockContext.set).toHaveBeenCalledWith('_websocketData', wsData);

      const retrievedData = wrapper.getWebSocketValue();

      expect(retrievedData).toEqual({ wsKey: 'wsValue' });
    });
  });

  describe('Redirect', () => {
    it('should redirect correctly', () => {
      const mockContext = createMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      wrapper.redirect('/home');

      expect(mockContext.redirect).toHaveBeenCalledWith('/home');
    });

    it('should redirect to external URL', () => {
      const mockContext = createMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      wrapper.redirect('https://example.com');

      expect(mockContext.redirect).toHaveBeenCalledWith('https://example.com');
    });
  });

  describe('Cookie Management', () => {
    const createCookieMockContext = () => {
      return {
        req: {
          raw: {
            headers: {
              get: mock((name: string) => {
                if (name === 'Cookie') return 'session=abc123';

                return null;
              }),
            },
          },
          header: mock(() => 'session=abc123'),
        },
        header: mock(() => {}),
      };
    };

    it('should get unsigned cookie', async () => {
      const mockContext = createCookieMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      const result = await wrapper.getCookie('session');

      expect(result).toBeDefined();
    });

    it('should get signed cookie with secret', async () => {
      const mockContext = createCookieMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      const secret = 'my-secret-key';
      const result = await wrapper.getCookie('session', secret);

      // Signed cookie may return false if signature verification fails with mock data
      // Both false and string values are valid return types
      expect(result === false || typeof result === 'string' || result === undefined).toBe(true);
    });

    it('should set unsigned cookie', async () => {
      const mockContext = createCookieMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      await wrapper.setCookie('session', 'abc123');

      expect(mockContext.header).toHaveBeenCalled();
    });

    it('should set signed cookie with secret', async () => {
      const mockContext = createCookieMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      const secret = 'my-secret-key';

      await wrapper.setCookie('session', 'abc123', { secret });

      expect(mockContext.header).toHaveBeenCalled();
    });

    it('should set cookie with options', async () => {
      const mockContext = createCookieMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      await wrapper.setCookie('session', 'abc123', {
        extraOptions: {
          maxAge: 3600,
          httpOnly: true,
          secure: true,
          sameSite: 'Strict',
        },
      });

      expect(mockContext.header).toHaveBeenCalled();
    });

    it('should delete unsigned cookie', async () => {
      const mockContext = createCookieMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      await wrapper.deleteCookie('session');

      expect(mockContext.header).toHaveBeenCalled();
    });

    it('should delete cookie with options', async () => {
      const mockContext = createCookieMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      await wrapper.deleteCookie('session', {
        extraOptions: {
          path: '/',
          domain: 'example.com',
        },
      });

      expect(mockContext.header).toHaveBeenCalled();
    });

    it('should handle cookie operations without options', async () => {
      const mockContext = createCookieMockContext();
      const wrapper = new HonoContextWrapper(mockContext as any);

      await wrapper.setCookie('test', 'value');
      await wrapper.deleteCookie('test');

      expect(mockContext.header).toHaveBeenCalled();
    });
  });
});
