import { middlewareParser } from "./utils/middlewareParser";
import type { Context as HonoAdapterContext } from "./defaults/Context";
import {
  AsenaWebsocketAdapter,
  type BaseMiddleware,
  type WebsocketAdapterParams,
  type WebsocketServiceRegistry,
} from "@asenajs/asena/adapter";
import type { Context, Hono, MiddlewareHandler } from "hono";
import * as bun from "bun";
import { type Server, type ServerWebSocket } from "bun";
import {
  AsenaSocket,
  AsenaWebSocketServer,
  AsenaWebSocketService,
  type WebSocketData,
  type WSEvents,
  type WSOptions,
} from "@asenajs/asena/web-socket";
import { green, yellow } from "@asenajs/asena/logger";

export class HonoWebsocketAdapter extends AsenaWebsocketAdapter<
  Hono,
  HonoAdapterContext
> {
  public name = "HonoWebsocketAdapter";

  private _server: Server;

  public constructor(params?: WebsocketAdapterParams<Hono>) {
    super(params);
  }

  public registerWebSocket(
    webSocketService: AsenaWebSocketService<any>,
    middlewares: BaseMiddleware<HonoAdapterContext>[],
  ): void {
    if (!webSocketService) {
      throw new Error("Websocket service is not provided");
    }

    if (this.websockets === undefined) {
      this.websockets = new Map<
        string,
        WebsocketServiceRegistry<HonoAdapterContext>
      >();
    }

    const namespace = webSocketService.namespace;

    if (!namespace) {
      throw new Error("Namespace is not provided");
    }

    this.logger.info(
      `${green("Successfully")} registered ${yellow("WEBSOCKET")} route for PATH: ${green(`/${webSocketService.namespace}`)}`,
    );

    this.websockets.set(namespace, { socket: webSocketService, middlewares });
  }

  public buildWebsocket(options?: WSOptions): void {
    if (!this.websockets || !this.websockets?.size) return;

    for (const [, websocket] of this.websockets) {
      this.upgradeWebSocket(websocket.socket, websocket.middlewares);
    }

    this.prepareWebSocket(options);
  }

  public startWebsocket(server: Server) {
    this._server = server;

    if (!this.websockets) {
      return;
    }

    for (const [namespace, websocket] of this.websockets) {
      websocket.socket.server = new AsenaWebSocketServer(server, namespace);
    }
  }

  private prepareWebSocket(options?: WSOptions): void {
    if (this.websockets?.size < 1) {
      return;
    }

    this.websocket = {
      open: this.createHandler("onOpenInternal"),
      message: this.createHandler("onMessage"),
      drain: this.createHandler("onDrain"),
      close: this.createHandler("onCloseInternal"),
      ping: this.createHandler("onPing"),
      pong: this.createHandler("onPong"),
      ...options,
    };
  }

  private upgradeWebSocket(
    websocket: AsenaWebSocketService<any>,
    middlewares: BaseMiddleware<HonoAdapterContext>[],
  ): void {
    const path = websocket.namespace;

    const preparedMiddlewares = this.prepareMiddlewares(middlewares);

    this.app.get(
      `/${path}`,
      ...preparedMiddlewares,
      async (c: Context, next) => {
        const websocketData = c.get("_websocketData") || {};

        const id = bun.randomUUIDv7();

        const data: WebSocketData = { values: websocketData, id, path: path };
        const upgradeResult = this._server.upgrade(c.req.raw, { data });

        if (upgradeResult) {
          return new Response(null);
        }

        await next(); // Failed
      },
    );
  }

  private createHandler(type: keyof WSEvents) {
    return (ws: ServerWebSocket<WebSocketData>, ...args: any[]) => {
      const websocket = this.websockets.get(ws.data.path);

      let handler = websocket?.socket[type];

      if (!handler) {
        return;
      }

      handler = handler.bind(websocket.socket);

      (handler as (socket: AsenaSocket<WebSocketData>, ...args: any[]) => void)(
        new AsenaSocket(ws, websocket.socket),
        ...args,
      );
    };
  }

  private prepareMiddlewares(
    middlewares: BaseMiddleware<HonoAdapterContext>[],
  ): MiddlewareHandler[] {
    return middlewareParser(middlewares);
  }
}
