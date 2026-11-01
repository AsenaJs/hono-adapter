import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { HttpMethod } from '@asenajs/asena/web-types';
import { HonoAdapter } from '../lib/HonoAdapter';
import type { Context } from '../lib/defaults/Context';
import { createMockLogger } from './utils/testHelpers';

const OUTSIDE_SECRET = 'OUTSIDE-ROOT-SECRET';
const SIBLING_SECRET = 'SIBLING-ROOT-SECRET';

const ESCAPING = [
  '/static/..%2fsecret%2fsecret.txt',
  '/static/%2e%2e%2fsecret%2fsecret.txt',
  '/static/..%2fpublic-private%2fcredentials.txt',
];

const MALFORMED = ['/static/%zz.txt', '/static/100%.txt', '/static/%e0%a4%a.txt'];

const NOT_FOUND = [
  '/static/../secret/secret.txt',
  '/static/%2e%2e/secret/secret.txt',
  '/static/%252e%252e%252fsecret%252fsecret.txt',
  '/static/..\\secret\\secret.txt',
  '/static/..%5csecret%5csecret.txt',
  '/static/../../../../../../../../etc/passwd',
  '/static/a%00.txt',
  '/static/hello.txt%00',
];

async function rawGet(port: number, target: string): Promise<{ status: number; body: string }> {
  const chunks: Uint8Array[] = [];

  await new Promise<void>((resolve, reject) => {
    Bun.connect({
      hostname: '127.0.0.1',
      port,
      socket: {
        open(socket) {
          socket.write(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
        },
        data(_socket, data) {
          chunks.push(data);
        },
        close() {
          resolve();
        },
        error(_socket, error) {
          reject(error);
        },
      },
    }).catch(reject);
  });

  const raw = Buffer.concat(chunks).toString();
  const split = raw.indexOf('\r\n\r\n');

  return {
    status: Number(raw.slice(0, split).split(' ')[1]),
    body: split === -1 ? '' : raw.slice(split + 4),
  };
}

describe('static path decoding', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'asena-static-bad-path-'));
  const root = path.join(base, 'public');

  fs.mkdirSync(root);
  fs.mkdirSync(path.join(base, 'public-private'));
  fs.mkdirSync(path.join(base, 'secret'));
  fs.writeFileSync(path.join(root, 'hello.txt'), 'hello');
  fs.mkdirSync(path.join(root, 'sub'));
  fs.writeFileSync(path.join(root, 'sub', 'file.txt'), 'sub-file');
  fs.writeFileSync(path.join(root, '100%.txt'), 'percent');
  fs.writeFileSync(path.join(base, 'public-private', 'credentials.txt'), SIBLING_SECRET);
  fs.writeFileSync(path.join(base, 'secret', 'secret.txt'), OUTSIDE_SECRET);

  let server: { stop: (force?: boolean) => void; port: number } | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  afterAll(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  async function boot() {
    const logger = createMockLogger();
    const adapter = new HonoAdapter({ logger });
    const probe = { rewrites: [] as string[], found: [] as string[], handler: 0 };

    adapter.setPort(0);
    adapter.registerRoute({
      method: HttpMethod.GET,
      path: '/static/*',
      middlewares: [],
      handler: async (context: Context) => {
        probe.handler++;

        return context.send({ fellThrough: true });
      },
      staticServe: {
        root,
        rewriteRequestPath: (requestPath: string) => {
          probe.rewrites.push(requestPath);

          return requestPath.replace('/static', '');
        },
        onFound: {
          handler: async (filePath: string) => {
            probe.found.push(filePath);
          },
          override: false,
        },
      },
      validator: null,
    } as any);

    server = (await adapter.start()) as any;

    return { probe, logger, port: server!.port };
  }

  it('answers 403 for a decoded path that leaves the root and serves nothing', async () => {
    const { probe, logger, port } = await boot();

    for (const target of ESCAPING) {
      const response = await rawGet(port, target);

      expect([target, response.status]).toEqual([target, 403]);
      expect(response.body).toBe('Forbidden');
    }

    expect(probe.found).toEqual([]);
    expect(probe.handler).toBe(0);
    expect(logger.warn).toHaveBeenCalledTimes(ESCAPING.length);
  });

  it('answers 400 for a malformed escape', async () => {
    const { probe, port } = await boot();

    for (const target of MALFORMED) {
      const response = await rawGet(port, target);

      expect([target, response.status]).toEqual([target, 400]);
      expect(JSON.parse(response.body)).toEqual({ error: 'Bad Request' });
    }

    expect(probe.found).toEqual([]);
    expect(probe.handler).toBe(0);
  });

  it('keeps plain, double-encoded, backslash and NUL spellings at 404 without leaking a file', async () => {
    const { probe, logger, port } = await boot();

    for (const target of NOT_FOUND) {
      const response = await rawGet(port, target);

      expect([target, response.status]).toEqual([target, 404]);
      expect(response.body).not.toContain(OUTSIDE_SECRET);
      expect(response.body).not.toContain(SIBLING_SECRET);
      expect(response.body).not.toContain('root:');
    }

    expect(probe.found).toEqual([]);
    expect(probe.handler).toBe(0);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('serves an in-root file and rewrites its path exactly once', async () => {
    const { probe, port } = await boot();

    for (const target of ['/static/hello.txt', '/static/hello%2etxt']) {
      const response = await rawGet(port, target);

      expect([target, response.status, response.body]).toEqual([target, 200, 'hello']);
    }

    expect(probe.rewrites).toEqual(['/static/hello.txt', '/static/hello.txt']);
  });

  it('serves an in-root file whose request path carries a reserved escape, rewriting it once', async () => {
    const { probe, port } = await boot();
    const served = [
      ['/static/sub%2Ffile.txt', 'sub-file'],
      ['/static/sub%2ffile.txt', 'sub-file'],
      ['/static/100%25.txt', 'percent'],
      ['/static/sub%2F..%2Fhello.txt', 'hello'],
    ];

    for (const [target, body] of served) {
      const response = await rawGet(port, target);

      expect([target, response.status, response.body]).toEqual([target, 200, body]);
    }

    expect(probe.rewrites).toEqual([
      '/static/sub/file.txt',
      '/static/sub/file.txt',
      '/static/100%.txt',
      '/static/sub/../hello.txt',
    ]);
    expect(probe.found).toHaveLength(served.length);
    expect(probe.handler).toBe(0);
  });

  it('keeps an in-root escaped path that names no file at 404', async () => {
    const { probe, port } = await boot();
    const response = await rawGet(port, '/static/sub%2Fmissing.txt');

    expect(response.status).toBe(404);
    expect(probe.handler).toBe(0);
  });
});
