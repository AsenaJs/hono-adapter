import { describe, expect, it } from 'bun:test';
import { HonoWebsocketAdapter } from '../lib/HonoWebsocketAdapter';
import { DefaultLogger } from '@asenajs/asena/logger';

describe('HonoWebsocketAdapter', () => {
  // Test adapter creation
  it('should create an adapter instance', () => {
    const adapter = new HonoWebsocketAdapter(console);

    expect(adapter).toBeDefined();
    expect(adapter.name).toBe('HonoWebsocketAdapter');
  });

  // Test logger setter
  it('should set the logger instance', () => {
    const adapter = new HonoWebsocketAdapter(console);
    const logger = new DefaultLogger();

    adapter.logger = logger;

    expect(adapter['_logger']).toBe(logger);
  });
});
