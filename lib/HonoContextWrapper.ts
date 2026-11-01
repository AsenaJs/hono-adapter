import {
  HttpException,
  ValidatedInput,
  readContractBody,
  readContractForm,
  type InputMap,
  type InputOutput,
  type InputTarget,
} from '@asenajs/asena/adapter';
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
import { getQueryParam } from 'hono/utils/url';
import { bufferToFormData } from 'hono/utils/buffer';

const VALIDATED_INPUT_KEY = '_asenaValidatedInput';

/** @internal Handlers the adapter registers with `app.use` for global middlewares. */
export const globalMiddlewareHandlers = new WeakSet<object>();

const TEXT_PLAIN = 'text/plain; charset=UTF-8';

const APPLICATION_JSON = 'application/json';

const invalidJsonBody = (error: unknown): HttpException =>
  new HttpException(400, {
    error: 'Invalid JSON in request body',
    message: error instanceof Error ? error.message : 'Failed to parse JSON',
  });

const hasEncoding = (value: string): boolean => value.includes('%') || value.includes('+');

const ENCODED_KEY = /(?:^|&)[^=&]*[%+]/;

const findQueryParam = (url: string, key: string): string | undefined => {
  if (!key || hasEncoding(key)) {
    return getQueryParam(url, key) as string | undefined;
  }

  const start = url.indexOf('?', 8);

  if (start === -1) {
    return undefined;
  }

  const length = key.length;
  let index = url.indexOf(key, start + 1);

  while (index !== -1) {
    const next = url.charCodeAt(index + length);

    if (
      (index === start + 1 || url.charCodeAt(index - 1) === 38) &&
      (next === 61 || next === 38 || Number.isNaN(next))
    ) {
      // ENCODED_KEY mirrors Hono's _getQueryParam check: an earlier encoded key may decode to this one.
      if (index > start + 1 && hasEncoding(url) && ENCODED_KEY.test(url.slice(start + 1, index - 1))) {
        return getQueryParam(url, key) as string | undefined;
      }

      if (next === 61) {
        const valueStart = index + length + 1;
        const end = url.indexOf('&', valueStart);
        const value = end === -1 ? url.slice(valueStart) : url.slice(valueStart, end);

        return hasEncoding(value) ? (getQueryParam(url, key) as string | undefined) : value;
      }

      return '';
    }

    index = url.indexOf(key, index + 1);
  }

  return hasEncoding(url) ? (getQueryParam(url, key) as string | undefined) : undefined;
};

export class HonoContextWrapper<I extends InputMap = Record<never, never>> implements AsenaContext<
  HonoRequest<any, any>,
  Response
> {
  // Kept on the Hono context so every wrapper of one request - global middleware, route
  // context subclass, error handler - sees the same validated input.
  private get validatedInput(): ValidatedInput<I> | undefined {
    return this._context.get(VALIDATED_INPUT_KEY as never) as ValidatedInput<I> | undefined;
  }

  private ensureValidatedInput(): ValidatedInput<I> {
    let validated = this.validatedInput;

    if (!validated) {
      validated = new ValidatedInput<I>();
      this._context.set(VALIDATED_INPUT_KEY as never, validated as never);
    }

    return validated;
  }

  public get input(): Readonly<I> {
    return this.validatedInput?.input ?? new ValidatedInput<I>().input;
  }

  /** @internal */
  public setValidated(target: InputTarget, value: unknown): void {
    this.ensureValidatedInput().set(target, value);
  }

  /** @internal */
  public completeValidatedInput(): void {
    this.ensureValidatedInput().complete();
  }

  /** @internal */
  public readContractInput(target: InputTarget): Promise<unknown> | unknown {
    switch (target) {
      case 'body':
        return readContractBody(() => this._context.req.arrayBuffer(), this._context.req.header('content-type') ?? '');
      case 'form':
        return readContractForm(() => this.readCachedFormData(), this._context.req.header('content-type') ?? '');
      case 'query':
        return this.getAllQueries();
      case 'headers':
        return (() => {
          const headers: Record<string, string> = {};
          this._context.req.raw.headers.forEach((value, key) => {
            headers[key.toLowerCase()] = value;
          });
          return headers;
        })();
      case 'params':
        return this._context.req.param();
    }
  }

  // Same approach as Hono's form validator: `req.formData()` over an already-read body rebuilds
  // it without the content type and fails to parse.
  private async readCachedFormData(): Promise<FormData> {
    const req = this._context.req;
    const cached = req.bodyCache.formData;

    if (cached) {
      return cached;
    }

    const formData = await bufferToFormData(await req.arrayBuffer(), req.header('content-type') ?? '');

    req.bodyCache.formData = formData;

    return formData;
  }

  private _context: Context;

  private _server?: Server<never>;

  private _requestIp?: string | null;

  private _url?: string;

  public constructor(context: Context, server?: Server<never>) {
    this._context = context;
    this._server = server;
  }

  public get req(): HonoRequest<any, any> {
    return this._context.req;
  }

  public get res() {
    return this._context.res;
  }

  public get routePattern(): string | undefined {
    try {
      for (const route of this._context.req.matchedRoutes) {
        if (!globalMiddlewareHandlers.has(route.handler)) {
          return route.path;
        }
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  public get headers(): Record<string, string> {
    const raw = this._context.req.raw.headers.toJSON() as Record<string, string | string[]>;
    const keys = Object.keys(raw);
    const count = keys.length;

    for (let i = 1; i < count; i++) {
      const key = keys[i];
      let j = i - 1;

      while (j >= 0 && keys[j] > key) {
        keys[j + 1] = keys[j];
        j--;
      }

      keys[j + 1] = key;
    }

    const headers: Record<string, string> = Object.create(null);

    for (let i = 0; i < count; i++) {
      const key = keys[i];

      if (key !== 'set-cookie') {
        headers[key] = raw[key] as string;
      }
    }

    const setCookie = raw['set-cookie'];

    if (setCookie !== undefined) {
      headers['set-cookie'] = typeof setCookie === 'string' ? setCookie : setCookie[setCookie.length - 1];
    }

    return headers;
  }

  public getArrayBuffer(): Promise<ArrayBuffer> {
    return this._context.req.arrayBuffer();
  }

  /**
   * Returns the validated form data when the route declares a `form` validator, the raw parsed
   * body otherwise.
   *
   * Same reasoning as {@link getBody}, one representation over: `zValidator` collapses repeated
   * keys into arrays and applies coercions into `req.valid('form')`, while `parseBody()` without
   * options is last-value-wins - so the handler read a shape the schema had already replaced.
   */
  public getParseBody<T = keyof I extends never ? any : InputOutput<I, 'form'>>(): Promise<T> {
    try {
      const req = this._context.req;
      const input = this.validatedInput;

      if (input?.has('form')) return Promise.resolve(input.get('form') as T);
      // Not `??`: a schema may legitimately parse to `null`, which would fall back to the raw body.
      const validated = req.valid?.('form' as never);

      if (validated !== undefined) {
        return Promise.resolve(validated as T);
      }

      return req.parseBody() as Promise<T>;
    } catch (error) {
      return Promise.reject(error as Error);
    }
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

  /**
   * Returns the validated body when the route declares a `json` validator, the raw parsed body
   * otherwise.
   *
   * The validator's output is what the schema actually describes - unknown keys stripped,
   * coercions and defaults applied. Reading `req.json()` here instead handed the schema's
   * guarantees straight back to the client: `updateById({ ...body })` behind a strict validator
   * still wrote whatever was sent. `zValidator` had the parsed value all along, in
   * `req.valid('json')`; nothing on this context read it.
   *
   * Routes without a validator are unaffected - `valid('json')` is undefined and we fall through.
   *
   * @throws HttpException - 400 Bad Request when the raw body is not valid JSON
   */
  public getBody<T = keyof I extends never ? any : InputOutput<I, 'body'>>(): Promise<T> {
    try {
      const req = this._context.req;
      const input = this.validatedInput;

      if (input?.has('body')) return Promise.resolve(input.get('body') as T);
      // Not `??`: a schema may legitimately parse to `null`, which would fall back to the raw body.
      const validated = req.valid?.('json' as never) as T | undefined;

      if (validated !== undefined) {
        return Promise.resolve(validated);
      }

      return req.json<T>().catch((error: unknown) => {
        throw invalidJsonBody(error);
      });
    } catch (error) {
      return Promise.reject(error as Error);
    }
  }

  public getQuery(query: string): Promise<string | undefined> {
    try {
      return Promise.resolve(findQueryParam((this._url ??= this._context.req.url), query));
    } catch (error) {
      return Promise.reject(error as Error);
    }
  }

  public getQueryAll(query: string): Promise<string[]> {
    try {
      return Promise.resolve(this._context.req.queries(query) ?? []);
    } catch (error) {
      return Promise.reject(error as Error);
    }
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
    let status = 200;
    let headers: SendOptions['headers'];

    if (typeof statusOrOptions === 'number') {
      status = statusOrOptions;
    } else if (statusOrOptions) {
      if (statusOrOptions.status !== undefined) {
        status = statusOrOptions.status;
      }

      headers = statusOrOptions.headers;
    }

    const context = this._context;

    if (headers !== undefined) {
      for (const [key, value] of Object.entries(headers)) {
        context.res.headers.append(key, value);
      }
    } else if (status === 200) {
      return typeof data === 'string' ? this.sendText(data) : this.sendJson(data);
    }

    if (typeof data === 'string') {
      return context.text(data, status as ContentfulStatusCode);
    }

    return context.json(data, status as ContentfulStatusCode, headers);
  }

  private sendText(data: string): Response {
    const response = this._context.text(data);

    if (response.headers.get('content-type') === null) {
      response.headers.set('Content-Type', TEXT_PLAIN);

      return response;
    }

    return response.status === 200 ? response : this._context.text(data, 200);
  }

  private sendJson(data: unknown): Response {
    const body = JSON.stringify(data);
    const response = this._context.text(body);

    if (response.headers.get('content-type') === null) {
      response.headers.set('Content-Type', APPLICATION_JSON);

      return response;
    }

    return this._context.body(body, 200, { 'Content-Type': APPLICATION_JSON });
  }

  public async getCookie(name: string, secret?: string | BufferSource): Promise<string | false> {
    return (secret ? await getSignedCookie(this._context, secret, name) : getCookie(this._context, name)) ?? false;
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

  /**
   * Replaces any value already set for the header - the core contract's semantics. To keep
   * existing values (`Vary`, `Link`, …) use {@link appendResponseHeader}.
   */
  public setResponseHeader(key: string, value: string): void {
    this._context.res.headers.set(key, value);
  }

  /**
   * Appends the value, keeping any value(s) already set for the header.
   */
  public appendResponseHeader(key: string, value: string): void {
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
  // A known key resolves to `never` here, so a wrong value cannot fall through to the `any` overload.
  public setValue<K extends string>(key: K extends keyof AsenaVariables ? never : K, value: any): void;
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
    // Hono's helper writes its own `event: error` frame after onError, so the callback runs here instead.
    return honoStreamSSE(this._context, async (honoStream) => {
      const writer = this.wrapSSEStreamingApi(honoStream);

      try {
        await cb(writer);
      } catch (error) {
        if (!onError || !(error instanceof Error)) {
          throw error;
        }

        await onError(error, writer);
      }
    });
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
    return Object.assign(this.wrapStreamingApi(honoStream), {
      writeSSE: async (message: Parameters<AsenaSSEStreamWriter['writeSSE']>[0]) => {
        if (message.data === undefined && message.comment === undefined) {
          throw new Error('writeSSE: message needs data or comment');
        }

        // Hono's writeSSE has no comment field, so comments are written by hand: one
        // `: <line>` per line, closed with a blank line. Comment first, then the event.
        if (message.comment !== undefined) {
          const lines = message.comment
            .split(/\r\n|\r|\n/)
            .map((line) => `: ${line}`)
            .join('\n');
          await honoStream.write(`${lines}\n\n`);
        }

        if (message.data !== undefined) {
          await honoStream.writeSSE({
            data: message.data,
            event: message.event,
            id: message.id,
            retry: message.retry,
          });
        }
      },
    });
  }

  public get context(): Context {
    return this._context;
  }

  public set context(value: Context) {
    this._context = value;
    this._url = undefined;
  }
}
