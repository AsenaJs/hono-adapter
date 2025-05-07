import type { Context } from './Context';
import type { AsenaConfig } from '@asenajs/asena/server/config';

export abstract class ConfigService implements AsenaConfig<Context> {}
