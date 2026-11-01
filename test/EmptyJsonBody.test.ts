import { afterEach, describe, expect, it } from 'bun:test';
import { HttpMethod } from '@asenajs/asena/web-types';
import { HonoAdapter } from '../lib/HonoAdapter';
import { createMockLogger } from './utils/testHelpers';

describe('empty JSON body', () => {
  let server: { stop: (force?: boolean) => void; port: number } | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  async function boot() {
    const adapter = new HonoAdapter({ logger: createMockLogger() });

    adapter.setPort(0);

    for (const method of [HttpMethod.POST, HttpMethod.GET]) {
      adapter.registerRoute({
        method,
        path: '/body',
        middlewares: [],
        handler: async (context) => {
          const first = await context.getBody();
          const second = await context.getBody();

          return context.send({ first, second });
        },
        staticServe: null,
        validator: null,
      });
    }

    server = (await adapter.start()) as any;

    return `http://localhost:${server!.port}/body`;
  }

  const cases: [string, RequestInit][] = [
    ['application/json, no body', { method: 'POST', headers: { 'Content-Type': 'application/json' } }],
    [
      'application/json, Content-Length 0',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '0' }, body: '' },
    ],
    ['no content type, empty body', { method: 'POST', body: '' }],
    ['whitespace-only body', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ' \n\t ' }],
    ['GET without a body', { method: 'GET' }],
  ];

  for (const [label, init] of cases) {
    it(`resolves {} for ${label}`, async () => {
      const url = await boot();
      const response = await fetch(url, init);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ first: {}, second: {} });
    });
  }

  it('still answers 400 for a non-empty invalid body', async () => {
    const url = await boot();
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ' {' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON in request body', message: expect.any(String) });
  });
});
