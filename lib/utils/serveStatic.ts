import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { MiddlewareHandler } from 'hono';
import { serveStatic as baseServeStatic, type ServeStaticOptions } from 'hono/serve-static';

type ContentGetter = Parameters<typeof baseServeStatic>[0]['getContent'];

const getContent = (async (path: string) => {
  try {
    const file = Bun.file(path);

    return (await file.exists()) ? file : null;
  } catch {
    return null;
  }
}) as unknown as ContentGetter;

const isDir = (path: string): boolean | undefined => {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory();
  } catch {
    return undefined;
  }
};

export const serveStatic = (options: ServeStaticOptions = {}): MiddlewareHandler =>
  baseServeStatic({ ...options, getContent, join, isDir });
