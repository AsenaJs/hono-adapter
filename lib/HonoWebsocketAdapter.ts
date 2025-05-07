import { AsenaWebsocketAdapter } from '@asenajs/asena/adapter';
import type { Server, ServerWebSocket } from 'bun';
import type { AsenaWebSocketService } from '@asenajs/asena/web-socket';
import {
  AsenaSocket,
  AsenaWebSocketServer,
  type WebSocketData,
  type WSEvents,
  type WSOptions,
} from '@asenajs/asena/web-socket';
import { green, type ServerLogger, yellow } from '@asenajs/asena/logger';

export class HonoWebsocketAdapter extends AsenaWebsocketAdapter {

  public name = 'HonoWebsocketAdapter';

  public constructor(logger: ServerLogger) {
    super(logger);
  }

  public registerWebSocket(webSocketService: AsenaWebSocketService<any>): void {
    if (!webSocketService) {
      throw new Error('Websocket service is not provided');
    }

    if (this.websockets === undefined) {
      this.websockets = new Map<string, AsenaWebSocketService<any>>();
    }

    const namespace = webSocketService.namespace;

    if (!namespace) {
      throw new Error('Namespace is not provided');
    }

    this.logger.info(
      `${green('Successfully')} registered ${yellow('WEBSOCKET')} route for PATH: ${green(`/${webSocketService.namespace}`)}`,
    );

    this.websockets.set(namespace, webSocketService);
  }

  public startWebsocket(server: Server) {
    if (!this.websockets || this.websockets.size < 1) {
      return;
    }

    for (const [namespace, websocket] of this.websockets) {
      websocket.server = new AsenaWebSocketServer(server, namespace);
    }
  }

  public prepareWebSocket(options?: WSOptions): void {
    if (this.websockets?.size < 1) {
      return;
    }

    this.websocket = {
      open: this.createHandler('onOpenInternal'),
      message: this.createHandler('onMessage'),
      drain: this.createHandler('onDrain'),
      close: this.createHandler('onCloseInternal'),
      ping: this.createHandler('onPing'),
      pong: this.createHandler('onPong'),
      ...options,
    };
  }

  private createHandler(type: keyof WSEvents) {
    return (ws: ServerWebSocket<WebSocketData>, ...args: any[]) => {
      const websocket = this.websockets.get(ws.data.path);

      let handler = websocket[type];

      if (!handler) {
        return;
      }

      handler = handler.bind(websocket);

      (handler as (socket: AsenaSocket<WebSocketData>, ...args: any[]) => void)(
        new AsenaSocket(ws, websocket),
        ...args,
      );
    };
  }

}
