import type { Server } from 'bun';
import type { Context, HonoRequest } from 'hono';
import type {
  AsenaContext,
  AsenaSSEStreamWriter,
  AsenaStreamWriter,
  AsenaVariables,
  CookieExtra,
  SendOptions,
} from '@asenajs/asena/adapter';
import { deleteCookie, getCookie, getSignedCookie, setCookie, setSignedCookie } from 'hono/cookie'; // add delete cookie
import { stream as honoStream, streamSSE as honoStreamSSE, streamText as honoStreamText } from 'hono/streaming';
import type { SSEStreamingApi } from 'hono/streaming';
import type { CookieOptions } from 'hono/utils/cookie';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { StreamingApi } from 'hono/utils/stream';

export class HonoContextWrapper implements AsenaContext<HonoRequest<any, any>, Response> {
  private _context: Context;

  private _server?: Server<never>;

  private _requestIp?: string | null;

  public constructor(context: Context, server?: Server<never>) {
    this._context = context;
    this._server = server;
  }

  public get req() {
    return this._context.req;
  }

  public get res() {
    return this._context.res;
  }

  public get routePattern(): string | undefined {
    try {
      return this._context.req.routePath;
    } catch {
      return undefined;
    }
  }

  public get headers(): Record<string, string> {
    return this._context.req.header();
  }

  public getArrayBuffer(): Promise<ArrayBuffer> {
    return this._context.req.arrayBuffer();
  }

  public getParseBody(): Promise<any> {
    return this._context.req.parseBody();
  }

  public getBlob(): Promise<Blob> {
    return this._context.req.blob();
  }

  public getFormData(): Promise<FormData> {
    return this._context.req.formData();
  }

  public getParam(s: string): string {
    return this._context.req.param(s);
  }

  public async getBody<T>(): Promise<T> {
    return await this._context.req.json<T>();
  }

  public async getQuery(query: string): Promise<string> {
    return this._context.req.query(query);
  }

  public async getQueryAll(query: string): Promise<string[]> {
    return this._context.req.queries(query);
  }

  public getAllQueries(): Record<string, string | string[]> {
    const queries = this._context.req.queries();
    const result: Record<string, string | string[]> = {};

    for (const [key, values] of Object.entries(queries)) {
      result[key] = values.length === 1 ? values[0] : values;
    }

    return result;
  }

  public send(data: string | any, statusOrOptions?: SendOptions | number): Response {
    const { headers = {}, status = 200 } =
      typeof statusOrOptions === 'number' ? { status: statusOrOptions } : statusOrOptions || {};

    if (headers !== undefined) {
      Object.entries(headers).forEach(([key, value]) => {
        this._context.res.headers.append(key, value);
      });
    }

    if (typeof data === 'string') {
      return this._context.text(data, status as ContentfulStatusCode);
    }

    return this._context.json(data, status as ContentfulStatusCode, headers);
  }

  public async getCookie(name: string, secret?: string | BufferSource): Promise<string | false> {
    return secret ? await getSignedCookie(this._context, secret, name) : getCookie(this._context, name);
  }

  public async setCookie(name: string, value: string, options?: CookieExtra<CookieOptions>) {
    const { secret, extraOptions } = options ?? {
      secret: undefined,
      extraOptions: undefined,
    };

    return secret
      ? setSignedCookie(this._context, name, value, secret, extraOptions)
      : setCookie(this._context, name, value, extraOptions);
  }

  public async deleteCookie(name: string, options?: CookieExtra<CookieOptions>) {
    const { extraOptions } = options ?? {
      secret: undefined,
      extraOptions: undefined,
    };

    deleteCookie(this._context, name, extraOptions);
  }

  public getRequestIp(): string | null {
    if (this._requestIp === undefined) {
      if (this._server) {
        const addr = this._server.requestIP(this._context.req.raw);

        this._requestIp = addr?.address ?? null;
      } else {
        this._requestIp = null;
      }
    }

    return this._requestIp;
  }

  public setResponseHeader(key: string, value: string): void {
    this._context.res.headers.append(key, value);
  }

  public redirect(url: string) {
    return this._context.redirect(url);
  }

  public getValue<K extends keyof AsenaVariables>(key: K): AsenaVariables[K];
  public getValue<T = any>(key: string): T;
  public getValue(key: string): any {
    return this._context.get(key);
  }

  public setValue<K extends keyof AsenaVariables>(key: K, value: AsenaVariables[K]): void;
  public setValue(key: string, value: any): void;
  public setValue(key: string, value: any): void {
    this._context.set(key, value);
  }

  public setWebSocketValue(value: any): void {
    this._context.set('_websocketData', value);
  }

  public getWebSocketValue<T>(): T {
    return this._context.get('_websocketData') as T;
  }

  public html(data: string, statusOrOptions?: SendOptions | number) {
    const { headers = {}, status = 200 } =
      typeof statusOrOptions === 'number' ? { status: statusOrOptions } : statusOrOptions || {};

    if (typeof data === 'string') {
      return this._context.html(data, status as ContentfulStatusCode, headers);
    }

    Object.entries(headers).forEach(([key, value]) => {
      this._context.res.headers.append(key, value);
    });

    return this._context.html(data, status as ContentfulStatusCode, headers);
  }

  public stream(
    cb: (stream: AsenaStreamWriter) => Promise<void>,
    onError?: (error: Error, stream: AsenaStreamWriter) => Promise<void>,
  ): Response {
    return honoStream(
      this._context,
      async (honoStream) => {
        await cb(this.wrapStreamingApi(honoStream));
      },
      onError
        ? async (e, honoStream) => {
            await onError(e, this.wrapStreamingApi(honoStream));
          }
        : undefined,
    );
  }

  public streamSSE(
    cb: (stream: AsenaSSEStreamWriter) => Promise<void>,
    onError?: (error: Error, stream: AsenaSSEStreamWriter) => Promise<void>,
  ): Response {
    return honoStreamSSE(
      this._context,
      async (honoStream) => {
        await cb(this.wrapSSEStreamingApi(honoStream));
      },
      onError
        ? async (e, honoStream) => {
            await onError(e, this.wrapSSEStreamingApi(honoStream));
          }
        : undefined,
    );
  }

  public streamText(
    cb: (stream: AsenaStreamWriter) => Promise<void>,
    onError?: (error: Error, stream: AsenaStreamWriter) => Promise<void>,
  ): Response {
    return honoStreamText(
      this._context,
      async (honoStream) => {
        await cb(this.wrapStreamingApi(honoStream));
      },
      onError
        ? async (e, honoStream) => {
            await onError(e, this.wrapStreamingApi(honoStream));
          }
        : undefined,
    );
  }

  private wrapStreamingApi(honoStream: StreamingApi): AsenaStreamWriter {
    return {
      // Hono's write/writeln resolve to the StreamingApi itself for chaining, but
      // AsenaStreamWriter promises `void`. Awaiting and returning nothing discards the value
      // without the `.then(() => {})` that only looks like a forgotten callback body.
      write: async (input: Uint8Array | string) => {
        await honoStream.write(input);
      },
      writeln: async (input: string) => {
        await honoStream.writeln(input);
      },
      close: () => honoStream.close(),
      pipe: (body: ReadableStream) => honoStream.pipe(body),
      onAbort: (listener: () => void | Promise<void>) => honoStream.onAbort(listener),
      get aborted() {
        return honoStream.aborted;
      },
      get closed() {
        return honoStream.closed;
      },
    };
  }

  private wrapSSEStreamingApi(honoStream: SSEStreamingApi): AsenaSSEStreamWriter {
    return {
      ...this.wrapStreamingApi(honoStream),
      writeSSE: (message) => honoStream.writeSSE(message),
    };
  }

  public get context(): Context {
    return this._context;
  }

  public set context(value: Context) {
    this._context = value;
  }
}
