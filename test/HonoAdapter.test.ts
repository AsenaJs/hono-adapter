import {describe, expect, it, mock, spyOn} from "bun:test";
import {HonoAdapter} from "../lib/HonoAdapter";
import {HonoWebsocketAdapter} from "../lib/HonoWebsocketAdapter";
import {DefaultLogger} from "@asenajs/asena/logger";
import {HttpMethod} from "@asenajs/asena/web-types";

describe("HonoAdapter", () => {
  // Test adapter creation
  it("should create an adapter instance", () => {
    const websocketAdapter = new HonoWebsocketAdapter();
    const logger = new DefaultLogger();
    const adapter = new HonoAdapter(websocketAdapter, logger);

    expect(adapter).toBeDefined();
    expect(adapter.name).toBe("HonoAdapter");
    expect(adapter.app).toBeDefined();
  });

  // Test middleware registration
  it("should register middleware correctly", () => {
    const websocketAdapter = new HonoWebsocketAdapter();
    const logger = new DefaultLogger();
    const adapter = new HonoAdapter(websocketAdapter, logger);

    const middleware = {
      handle: mock(() => (_c, next) => next()),
      override: false,
    };

    const spy = spyOn(adapter.app, "use");
    
    adapter.use(middleware);
    
    expect(spy).toHaveBeenCalled();
  });

  // Test route registration
  it("should register a route correctly", async () => {
    const websocketAdapter = new HonoWebsocketAdapter();
    const logger = new DefaultLogger();
    const adapter = new HonoAdapter(websocketAdapter, logger);

    const spy = spyOn(adapter.app, "get");
    const handler = mock(() => {});

    await adapter.registerRoute({
      staticServe: false,
      validator: null,
      method: HttpMethod.GET,
      path: "/test",
      middleware: [],
      handler
    });

    expect(spy).toHaveBeenCalled();
  });

  // Test port setting
  it("should set port correctly", () => {
    const websocketAdapter = new HonoWebsocketAdapter();
    const logger = new DefaultLogger();
    const adapter = new HonoAdapter(websocketAdapter, logger);

    adapter.setPort(3000);
    expect(adapter["port"]).toBe(3000);
  });

  // Test error handler registration
  it("should register an error handler", () => {
    const websocketAdapter = new HonoWebsocketAdapter();
    const logger = new DefaultLogger();
    const adapter = new HonoAdapter(websocketAdapter, logger);

    const spy = spyOn(adapter.app, "onError");
    const errorHandler = mock(() => new Response("Error"));

    adapter.onError(errorHandler);
    
    expect(spy).toHaveBeenCalled();
  });
}); 