import { HonoAdapter } from '../../index';
import type { ServerLogger } from '@asenajs/asena/logger';
import type { HonoAdapterOptions } from '../types/HonoAdapterOptions';

const createConsoleLogger = (): ServerLogger => {
  const runningProfiles = new Set<string>();

  return {
    info: (message: string, ...meta: unknown[]) => console.log(`[INFO]: ${message}`, ...meta),
    warn: (message: string, ...meta: unknown[]) => console.warn(`[WARN]: ${message}`, ...meta),
    error: (message: string, ...meta: unknown[]) => console.error(`[ERROR]: ${message}`, ...meta),
    profile: (id: string) => {
      if (runningProfiles.delete(id)) {
        console.timeEnd(id);
      } else {
        runningProfiles.add(id);
        console.time(id);
      }
    },
  };
};

const isServerLogger = (value: ServerLogger | Partial<HonoAdapterOptions>): value is ServerLogger =>
  typeof (value as Partial<ServerLogger>).info === 'function';

export const createHonoAdapter = (
  loggerOrOptions: ServerLogger | Partial<HonoAdapterOptions> = {},
): [HonoAdapter, ServerLogger] => {
  const options = isServerLogger(loggerOrOptions) ? { logger: loggerOrOptions } : loggerOrOptions;
  const logger = options.logger ?? createConsoleLogger();

  return [new HonoAdapter({ ...options, logger }), logger];
};
