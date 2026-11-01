import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { HttpMethod } from '@asenajs/asena/web-types';
import type { AsenaSSEStreamWriter } from '@asenajs/asena/adapter';
import type { Context } from '../lib/defaults/Context';
import { createTestAdapter, registerRoute, startTestServer } from './utils/testHelpers';

const parseSse = (text: string) =>
  text
    .split('\n\n')
    .filter((frame) => frame.trim() !== '')
    .map((frame) => {
      const event: Record<string, string> = {};

      for (const line of frame.split('\n')) {
        const colon = line.indexOf(':');

        event[line.slice(0, colon)] = line.slice(colon + 2);
      }

      return event;
    });

describe('SSE error callback owns the stream output', () => {
  let server: { stop: (force?: boolean) => void } | undefined;
  let baseUrl: string;
  const emptyFrame: { errors: unknown[]; continuedAfterThrow: boolean } = { errors: [], continuedAfterThrow: false };

  beforeAll(async () => {
    const { adapter } = createTestAdapter();

    await registerRoute(adapter, {
      method: HttpMethod.GET,
      path: '/sse/error',
      handler: (context: Context) =>
        context.streamSSE(
          async () => {
            throw new Error('Database connection lost');
          },
          async (error, stream) => {
            await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: error.message }) });
          },
        ),
    });

    await registerRoute(adapter, {
      method: HttpMethod.GET,
      path: '/sse/empty-frame',
      handler: (context: Context) =>
        context.streamSSE(
          async (stream) => {
            await stream.writeSSE({ data: 'before' });
            await stream.writeSSE({} as Parameters<AsenaSSEStreamWriter['writeSSE']>[0]);
            emptyFrame.continuedAfterThrow = true;
          },
          async (error, stream) => {
            emptyFrame.errors.push(error);
            await stream.writeSSE({ event: 'error', data: error.message });
          },
        ),
    });

    await registerRoute(adapter, {
      method: HttpMethod.GET,
      path: '/sse/silent-callback',
      handler: (context: Context) =>
        context.streamSSE(
          async (stream) => {
            await stream.writeSSE({ data: 'only' });
            throw new Error('swallowed');
          },
          async () => {},
        ),
    });

    const started = await startTestServer(adapter);

    server = started.server;
    baseUrl = started.baseUrl;
  });

  afterAll(() => {
    server?.stop(true);
  });

  it('delivers exactly the event the error callback wrote', async () => {
    const response = await fetch(`${baseUrl}/sse/error`);

    expect(response.status).toBe(200);
    expect(parseSse(await response.text())).toEqual([
      { event: 'error', data: JSON.stringify({ error: 'Database connection lost' }) },
    ]);
  });

  it('rejects a frame with neither data nor comment into the callback without writing it', async () => {
    const response = await fetch(`${baseUrl}/sse/empty-frame`);
    const events = parseSse(await response.text());

    expect(emptyFrame.errors).toHaveLength(1);
    expect(emptyFrame.errors[0]).toBeInstanceOf(Error);
    expect(emptyFrame.continuedAfterThrow).toBe(false);
    expect(events).toEqual([{ data: 'before' }, { event: 'error', data: (emptyFrame.errors[0] as Error).message }]);
  });

  it('adds nothing when the error callback writes nothing', async () => {
    const response = await fetch(`${baseUrl}/sse/silent-callback`);

    expect(parseSse(await response.text())).toEqual([{ data: 'only' }]);
  });
});
