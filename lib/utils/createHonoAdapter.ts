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

export const createHonoAdapter = (
  loggerOrOptions: ServerLogger | Partial<HonoAdapterOptions> = {},
): [HonoAdapter, ServerLogger] => {
  const options =
    'logger' in loggerOrOptions || !('info' in loggerOrOptions) ? loggerOrOptions : { logger: loggerOrOptions };
  const logger = options.logger ?? createConsoleLogger();

  return [new HonoAdapter({ ...options, logger }), logger];
};
