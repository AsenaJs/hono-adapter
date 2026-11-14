import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type { Server } from 'bun';
import { Hono } from 'hono';
import type { ServerLogger } from '@asenajs/asena/logger';
import { createDeepMock } from '@asenajs/asena/test';
import { createHonoAdapter } from '../lib/utils/createHonoAdapter';
import { HonoAdapter } from '../lib/HonoAdapter';
import { HonoWebsocketAdapter } from '../lib/HonoWebsocketAdapter';
import { createMockLogger, registerRoute } from './utils/testHelpers';

class DelegatingLogger implements ServerLogger {
  public constructor(private readonly logger: ServerLogger = createMockLogger()) {}

  public info(message: string, meta?: unknown) {
    this.logger.info(message, meta);
  }

  public warn(message: string, meta?: unknown) {
    this.logger.warn(message, meta);
  }

  public error(message: string, meta?: unknown) {
    this.logger.error(message, meta);
  }

  public profile(id: string) {
    this.logger.profile(id);
  }
}

const getTrapLogger = (): ServerLogger => {
  const methods = createMockLogger();

  return new Proxy({} as ServerLogger, { get: (_target, key) => Reflect.get(methods, key) });
};

const bareLoggers: [string, () => ServerLogger][] = [
  ['a plain object', createMockLogger],
  ['a class instance with its own logger field', () => new DelegatingLogger()],
  ['a Proxy that answers from a get trap only', getTrapLogger],
  ['a deep mock', () => createDeepMock()],
];

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

  it.each(bareLoggers)('uses a logger passed on its own, with the default options (%s)', (_label, createLogger) => {
    const logger = createLogger();
    const [adapter, returnedLogger] = createHonoAdapter(logger);

    expect(returnedLogger).toBe(logger);
    expect(adapter['logger']).toBe(logger);
    expect(adapter.getWebsocketAdapter()?.logger).toBe(logger);
    expect(adapter['_strict']).toBe(false);
    expect(adapter['logErrors']).toBe(true);
  });

  it('takes the logger and the options from an options object', () => {
    const logger = createMockLogger();
    const [adapter, returnedLogger] = createHonoAdapter({ logger, strict: true, logErrors: false });

    expect(returnedLogger).toBe(logger);
    expect(adapter['logger']).toBe(logger);
    expect(adapter.getWebsocketAdapter()?.logger).toBe(logger);
    expect(adapter['_strict']).toBe(true);
    expect(adapter['logErrors']).toBe(false);
  });
});

describe('new HonoAdapter', () => {
  it.each(bareLoggers)('uses a logger passed on its own, with the default options (%s)', (_label, createLogger) => {
    const logger = createLogger();
    const adapter = new HonoAdapter(logger);

    expect(adapter['logger']).toBe(logger);
    expect(adapter.getWebsocketAdapter()?.logger).toBe(logger);
    expect(adapter['_strict']).toBe(false);
    expect(adapter['logErrors']).toBe(true);
  });

  it('takes the WebSocket adapter and the app passed after the logger', () => {
    const logger = createMockLogger();
    const websocketAdapter = new HonoWebsocketAdapter(logger);
    const app = new Hono();
    const adapter = new HonoAdapter(logger, websocketAdapter, app);

    expect(adapter['logger']).toBe(logger);
    expect(adapter.getWebsocketAdapter()).toBe(websocketAdapter);
    expect(adapter.app).toBe(app);
  });

  it('takes the logger and the options from an options object', () => {
    const logger = createMockLogger();
    const adapter = new HonoAdapter({ logger, strict: true, logErrors: false });

    expect(adapter['logger']).toBe(logger);
    expect(adapter.getWebsocketAdapter()?.logger).toBe(logger);
    expect(adapter['_strict']).toBe(true);
    expect(adapter['logErrors']).toBe(false);
  });
});

describe('createHonoAdapter without a logger', () => {
  const silenceConsole = () => ({
    log: spyOn(console, 'log').mockImplementation(() => {}),
    warn: spyOn(console, 'warn').mockImplementation(() => {}),
    error: spyOn(console, 'error').mockImplementation(() => {}),
    time: spyOn(console, 'time').mockImplementation(() => {}),
    timeEnd: spyOn(console, 'timeEnd').mockImplementation(() => {}),
  });

  let consoleSpy: ReturnType<typeof silenceConsole>;
  let server: Server<any> | undefined;

  beforeEach(() => {
    consoleSpy = silenceConsole();
  });

  afterEach(() => {
    server?.stop(true);
    server = undefined;

    for (const spy of Object.values(consoleSpy)) {
      spy.mockRestore();
    }
  });

  it.each([
    ['no argument', () => createHonoAdapter()],
    ['options without a logger', () => createHonoAdapter({ logErrors: false })],
    ['options with logger: undefined', () => createHonoAdapter({ logger: undefined })],
  ])('returns the logger the adapter uses (%s)', (_label, create) => {
    const [adapter, logger] = create();

    for (const method of ['info', 'warn', 'error', 'profile'] as const) {
      expect(logger[method]).toBeFunction();
    }

    expect(adapter['logger']).toBe(logger);
    expect(adapter.getWebsocketAdapter()?.logger).toBe(logger);
  });

  it('applies the options it is given', async () => {
    const [adapter] = createHonoAdapter({ strict: true });

    adapter.setPort(0);
    await registerRoute(adapter, { path: '/x' });
    server = await adapter.start();

    expect((await fetch(`http://localhost:${server.port}/x`)).status).toBe(200);
    expect((await fetch(`http://localhost:${server.port}/x/`)).status).toBe(404);
  });

  it('writes info, warn and error to the console under their level', () => {
    const [, logger] = createHonoAdapter();
    const failure = new Error('boom');

    logger.info('started', { port: 1 });
    logger.warn('careful');
    logger.error('failed', failure);

    expect(consoleSpy.log).toHaveBeenCalledWith('[INFO]: started', { port: 1 });
    expect(consoleSpy.warn).toHaveBeenCalledWith('[WARN]: careful');
    expect(consoleSpy.error).toHaveBeenCalledWith('[ERROR]: failed', failure);
  });

  it('starts a profile on the first call and ends it on the second', () => {
    const [, logger] = createHonoAdapter();

    logger.profile('boot');

    expect(consoleSpy.time).toHaveBeenCalledWith('boot');
    expect(consoleSpy.timeEnd).not.toHaveBeenCalled();

    logger.profile('boot');

    expect(consoleSpy.timeEnd).toHaveBeenCalledWith('boot');

    logger.profile('boot');

    expect(consoleSpy.time).toHaveBeenCalledTimes(2);
    expect(consoleSpy.timeEnd).toHaveBeenCalledTimes(1);
  });
});
