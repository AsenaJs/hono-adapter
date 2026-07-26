export * from './lib/HonoAdapter';
export * from './lib/HonoWebsocketAdapter';
export * from './lib/types';
export * from './lib/defaults';
export * from './lib/utils/createHonoAdapter';
export * from './lib/errors';

// Re-export Hono's HTTPException for user convenience in middlewares
export { HTTPException } from 'hono/http-exception';
