import { AsenaStaticServeService } from '@asenajs/asena/middleware';
import type { StaticServeExtras } from '../types';
import type { Context } from './Context';

export abstract class StaticServeService extends AsenaStaticServeService<Context, StaticServeExtras> {}
