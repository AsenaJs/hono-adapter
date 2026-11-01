import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { HttpMethod } from '@asenajs/asena/web-types';
import type { Context } from '../lib/defaults/Context';
import { createTestAdapter, registerRoute, startTestServer } from './utils/testHelpers';

describe('stream() and streamText() error callbacks own the stream output', () => {
  let server: { stop: (force?: boolean) => void } | undefined;
  let baseUrl: string;

  beforeAll(async () => {
    const { adapter } = createTestAdapter();

    for (const kind of ['stream', 'streamText'] as const) {
      await registerRoute(adapter, {
        method: HttpMethod.GET,
        path: `/${kind}/error`,
        handler: (context: Context) =>
          context[kind](
            async (stream) => {
              await stream.write('partial;');
              throw new Error('Database connection lost');
            },
            async (error, stream) => {
              await stream.write(`callback:${error.message}`);
            },
          ),
      });

      await registerRoute(adapter, {
        method: HttpMethod.GET,
        path: `/${kind}/silent-callback`,
        handler: (context: Context) =>
          context[kind](
            async (stream) => {
              await stream.write('only');
              throw new Error('swallowed');
            },
            async () => {},
          ),
      });
    }

    const started = await startTestServer(adapter);

    server = started.server;
    baseUrl = started.baseUrl;
  });

  afterAll(() => {
    server?.stop(true);
  });

  for (const kind of ['stream', 'streamText'] as const) {
    it(`${kind}: the client receives what the handler and the callback wrote, nothing more`, async () => {
      const response = await fetch(`${baseUrl}/${kind}/error`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('partial;callback:Database connection lost');
    });

    it(`${kind}: a silent callback adds nothing and the stream closes`, async () => {
      const response = await fetch(`${baseUrl}/${kind}/silent-callback`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('only');
    });
  }

  it('streamText keeps its text/plain content type on the error path', async () => {
    const response = await fetch(`${baseUrl}/streamText/error`);

    expect(response.headers.get('content-type')).toStartWith('text/plain');
    await response.text();
  });
});
