import { describe, expect, it, mock, spyOn } from 'bun:test';
import { HonoAdapter } from '../lib/HonoAdapter';
import { HonoWebsocketAdapter } from '../lib/HonoWebsocketAdapter';
import { DefaultLogger } from '@asenajs/asena/logger';
import { HttpMethod } from '@asenajs/asena/web-types';

describe('HonoAdapter', () => {
  // Test adapter creation
  it('should create an adapter instance', () => {
    const logger = new DefaultLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    expect(adapter).toBeDefined();
    expect(adapter.name).toBe('HonoAdapter');
    expect(adapter.app).toBeDefined();
  });

  // Test middleware registration
  it('should register middleware correctly', () => {
    const logger = new DefaultLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const middleware = {
      handle: mock(() => (_c, next) => next()),
      override: false,
    };

    const spy = spyOn(adapter.app, 'use');

    adapter.use(middleware);

    expect(spy).toHaveBeenCalled();
  });

  // Test route registration
  it('should register a route correctly', async () => {
    const logger = new DefaultLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const spy = spyOn(adapter.app, 'get');
    const handler = mock(() => {});

    await adapter.registerRoute({
      staticServe: false,
      validator: null,
      method: HttpMethod.GET,
      path: '/test',
      middlewares: [],
      handler,
    });

    expect(spy).toHaveBeenCalled();
  });

  // Test port setting
  it('should set port correctly', () => {
    const logger = new DefaultLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    adapter.setPort(3000);
    expect(adapter['port']).toBe(3000);
  });

  // Test error handler registration
  it('should register an error handler', () => {
    const logger = new DefaultLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const adapter = new HonoAdapter(logger, websocketAdapter);

    const spy = spyOn(adapter.app, 'onError');
    const errorHandler = mock(() => new Response('Error'));

    adapter.onError(errorHandler);

    expect(spy).toHaveBeenCalled();
  });
});
