import { describe, expect, it } from 'bun:test';
import { createHonoAdapter } from '../lib/utils/createHonoAdapter';
import { HonoAdapter } from '../lib/HonoAdapter';
import { createMockLogger } from './utils/testHelpers';

describe('createHonoAdapter', () => {
  it('should create adapter with ServerLogger argument', () => {
    const logger = createMockLogger();
    const [adapter, returnedLogger] = createHonoAdapter(logger);

    expect(adapter).toBeInstanceOf(HonoAdapter);
    expect(returnedLogger).toBe(logger);
  });

  it('should create adapter with HonoAdapterOptions argument', () => {
    const logger = createMockLogger();
    const [adapter, returnedLogger] = createHonoAdapter({ logger });

    expect(adapter).toBeInstanceOf(HonoAdapter);
    expect(returnedLogger).toBe(logger);
  });

  it('should return [HonoAdapter, ServerLogger] tuple', () => {
    const logger = createMockLogger();
    const result = createHonoAdapter(logger);

    expect(result).toBeArray();
    expect(result).toHaveLength(2);
    expect(result[0]).toBeInstanceOf(HonoAdapter);
  });

  it('should pass custom options to adapter', () => {
    const logger = createMockLogger();
    const [adapter] = createHonoAdapter({ logger, strict: false });

    expect(adapter).toBeInstanceOf(HonoAdapter);
    expect(adapter.name).toBe('HonoAdapter');
  });
});