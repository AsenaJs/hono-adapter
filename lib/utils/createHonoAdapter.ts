import { HonoAdapter } from '../../index';
import type { ServerLogger } from '@asenajs/asena/logger';

export const createHonoAdapter = (logger?: ServerLogger): [HonoAdapter, ServerLogger] => {
  return [new HonoAdapter(logger), logger];
};
