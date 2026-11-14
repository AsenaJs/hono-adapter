import type { ServerLogger } from '@asenajs/asena/logger';
import type { HonoAdapterOptions } from '../types/HonoAdapterOptions';

export const isServerLogger = (value: ServerLogger | Partial<HonoAdapterOptions>): value is ServerLogger =>
  typeof (value as Partial<ServerLogger>).info === 'function';
