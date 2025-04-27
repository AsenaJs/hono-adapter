import { describe, expect, it, mock } from 'bun:test';
import { HonoContextWrapper } from '../lib/HonoContextWrapper';

describe('HonoContextWrapper', () => {
  const createMockContext = () => {
    return {
      req: {
        header: mock(() => ({})),
        arrayBuffer: mock(() => Promise.resolve(new ArrayBuffer(0))),
        parseBody: mock(() => Promise.resolve({})),
        blob: mock(() => Promise.resolve(new Blob())),
        formData: mock(() => Promise.resolve(new FormData())),
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
      get: mock((key) => `value-${key}`),
      set: mock(() => {}),
      html: mock(() => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } })),
      redirect: mock(() => new Response('', { status: 302 })),
    };
  };

  // Test constructor and getter methods
  it('should create a wrapper instance and provide access to context properties', () => {
    const mockContext = createMockContext();
    const wrapper = new HonoContextWrapper(mockContext as any);

    expect(wrapper).toBeDefined();
    // @ts-ignore
    expect(wrapper.req).toBe(mockContext.req);
    // @ts-ignore

    expect(wrapper.res).toBe(mockContext.res);
  });

  // Test getParam method
  it('should get a parameter by name', () => {
    const mockContext = createMockContext();
    const wrapper = new HonoContextWrapper(mockContext as any);

    const param = wrapper.getParam('id');

    expect(param).toBe('param-id');
    expect(mockContext.req.param).toHaveBeenCalledWith('id');
  });

  // Test send method for string data
  it('should send string data correctly', () => {
    const mockContext = createMockContext();
    const wrapper = new HonoContextWrapper(mockContext as any);

    wrapper.send('Hello World');

    expect(mockContext.text).toHaveBeenCalledWith('Hello World');
  });

  // Test send method for JSON data
  it('should send JSON data correctly', () => {
    const mockContext = createMockContext();
    const wrapper = new HonoContextWrapper(mockContext as any);

    const data = { message: 'Hello World' };

    wrapper.send(data);

    expect(mockContext.json).toHaveBeenCalledWith(data, 200, {});
  });

  // Test getValue and setValue methods
  it('should get and set context values', () => {
    const mockContext = createMockContext();
    const wrapper = new HonoContextWrapper(mockContext as any);

    wrapper.setValue('key', 'value');
    const value = wrapper.getValue('key');

    expect(mockContext.set).toHaveBeenCalledWith('key', 'value');
    expect(value).toBe('value-key');
  });

  // Test HTML method
  it('should send HTML content correctly', () => {
    const mockContext = createMockContext();
    const wrapper = new HonoContextWrapper(mockContext as any);

    const html = '<p>Hello World</p>';

    wrapper.html(html);

    expect(mockContext.html).toHaveBeenCalledWith(html, 200, {});
  });

  // Test redirect method
  it('should redirect correctly', () => {
    const mockContext = createMockContext();
    const wrapper = new HonoContextWrapper(mockContext as any);

    wrapper.redirect('/home');

    expect(mockContext.redirect).toHaveBeenCalledWith('/home');
  });
});
