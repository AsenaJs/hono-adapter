import {describe, expect, it} from "bun:test";
import {HonoWebsocketAdapter} from "../lib/HonoWebsocketAdapter";
import {Hono} from "hono";
import {DefaultLogger} from "@asenajs/asena/logger";

describe("HonoWebsocketAdapter", () => {
  // Test adapter creation
  it("should create an adapter instance", () => {
    const adapter = new HonoWebsocketAdapter();
    expect(adapter).toBeDefined();
    expect(adapter.name).toBe("HonoWebsocketAdapter");
  });

  // Test app setter
  it("should set the Hono app instance", () => {
    const adapter = new HonoWebsocketAdapter();
    const app = new Hono();
    
    adapter.app = app;
    
    expect(adapter["_app"]).toBe(app);
  });

  // Test logger setter
  it("should set the logger instance", () => {
    const adapter = new HonoWebsocketAdapter();
    const logger = new DefaultLogger();
    
    adapter.logger = logger;
    
    expect(adapter["_logger"]).toBe(logger);
  });

  // Test startWebsocket method
  it("should set the server instance", () => {
    const adapter = new HonoWebsocketAdapter();
    // Create a minimal mock
    const mockServer = {} as any;
    
    adapter.startWebsocket(mockServer);
    
    expect(adapter["_server"]).toBe(mockServer);
  });
}); 