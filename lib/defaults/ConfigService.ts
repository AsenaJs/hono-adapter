import type { Context } from './Context';
import type { AsenaConfig } from '@asenajs/asena/server/config';

/**
 * Base class for Hono configuration services
 *
 * Binds Asena's config service interface to the Hono adapter's Context type. Every hook
 * (`onError`, `serveOptions`, `globalMiddlewares`, `transport`) is optional - override
 * only the ones your application needs.
 *
 * @example
 * ```typescript
 * import { Config } from '@asenajs/asena/decorators';
 * import { ConfigService, type Context } from '@asenajs/hono-adapter';
 *
 * @Config()
 * export class ServerConfig extends ConfigService {
 *   onError(error: Error, context: Context): Response {
 *     return context.send({ error: error.message }, 500);
 *   }
 * }
 * ```
 */
// Merged with the same-named interface below on purpose - see its doc comment.
/* eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging */
export abstract class ConfigService implements AsenaConfig<Context> {}

/**
 * Hook signatures for {@link ConfigService}, contributed through declaration merging.
 *
 * The framework reads these hooks reflectively (`typeof config.onError === 'function'`),
 * so a hook with the wrong shape is a silent no-op at runtime. Merging the interface into
 * the class makes the compiler check every override against the real signature - a
 * mistyped `onError` or a `globalMiddlewares` that returns the wrong entry type now fails
 * the build instead of quietly never running.
 *
 * Declaring them here rather than on the class body is deliberate: `abstract onError?()`
 * would still force every subclass to implement it (TS2515), and a class property would
 * clash with subclasses that implement the hook as a method (TS2425).
 */
/* eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unsafe-declaration-merging */
export interface ConfigService extends AsenaConfig<Context> {}
