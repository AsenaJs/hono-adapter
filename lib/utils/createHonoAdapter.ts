import { HonoAdapter } from '../../index';
import type { ServerLogger } from '@asenajs/asena/logger';
import type { HonoAdapterOptions } from '../types/HonoAdapterOptions';

export const createHonoAdapter = (
  loggerOrOptions?: ServerLogger | Partial<HonoAdapterOptions>,
): [HonoAdapter, ServerLogger] => {
  if (loggerOrOptions && typeof loggerOrOptions === 'object' && 'logger' in loggerOrOptions) {
    const logger = loggerOrOptions.logger;

    return [
      new HonoAdapter(loggerOrOptions as HonoAdapterOptions),
      logger,
    ];
  }

  const logger = loggerOrOptions as ServerLogger;

  return [new HonoAdapter(logger), logger];
};
