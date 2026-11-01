import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { HttpMethod } from '@asenajs/asena/web-types';
import type { Context } from '../lib/defaults/Context';
import { createTestAdapter, registerRoute, startTestServer } from './utils/testHelpers';

const waitFor = async (condition: () => boolean, label: string) => {
  const deadline = Date.now() + 2000;

  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(5);
  }
};

describe('SSE writer reports live aborted / closed state', () => {
  let server: { stop: (force?: boolean) => void } | undefined;
  let baseUrl: string;
  const probe = { onAbortFired: false, abortedAfterOnAbort: undefined as boolean | undefined, finished: false };
  const closeProbe = { before: undefined as boolean | undefined, after: undefined as boolean | undefined };

  beforeAll(async () => {
    const { adapter } = createTestAdapter();

    await registerRoute(adapter, {
      method: HttpMethod.GET,
      path: '/sse/long-lived',
      handler: (context: Context) =>
        context.streamSSE(async (stream) => {
          stream.onAbort(() => {
            probe.onAbortFired = true;
          });
          await stream.writeSSE({ event: 'status', data: 'connected' });

          const deadline = Date.now() + 3000;

          while (!probe.onAbortFired && Date.now() < deadline) {
            await Bun.sleep(5);
          }

          probe.abortedAfterOnAbort = stream.aborted;
          probe.finished = true;
        }),
    });

    await registerRoute(adapter, {
      method: HttpMethod.GET,
      path: '/sse/close',
      handler: (context: Context) =>
        context.streamSSE(async (stream) => {
          await stream.writeSSE({ data: 'one' });
          closeProbe.before = stream.closed;
          await stream.close();
          closeProbe.after = stream.closed;
        }),
    });

    const started = await startTestServer(adapter);

    server = started.server;
    baseUrl = started.baseUrl;
  });

  afterAll(() => {
    server?.stop(true);
  });

  it('reports aborted after a client abort fired onAbort', async () => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/sse/long-lived`, { signal: controller.signal });
    const reader = response.body!.getReader();

    await reader.read();
    controller.abort();
    await reader.cancel().catch(() => undefined);

    await waitFor(() => probe.finished, 'handler to return');

    expect(probe.onAbortFired).toBe(true);
    expect(probe.abortedAfterOnAbort).toBe(true);
  });

  it('reports closed after close()', async () => {
    const response = await fetch(`${baseUrl}/sse/close`);

    await response.text();
    await waitFor(() => closeProbe.after !== undefined, 'close probe');

    expect(closeProbe.before).toBe(false);
    expect(closeProbe.after).toBe(true);
  });
});
