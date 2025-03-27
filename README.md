# Asena Hono Adapter

HTTP and WebSocket adapter implementation based on Hono web framework for Asena.js.

## Features

- Fast and modern API endpoints with [Hono](https://hono.dev/) web framework
- High performance with Bun runtime
- Full type support with TypeScript
- HTTP and WebSocket adapter support
- Easy integration and usage
- Validation support with Zod
- Decorators for controller-based routing

## Requirements

- [Bun](https://bun.sh)
- TypeScript v5.8.2 or above

## Installation

1. Install with NPM package manager:
```bash
bun add @asenajs/hono-adapter
```

## Usage

### Server Setup (index.ts)

```typescript
import { AsenaServer } from '@asenajs/asena';
import { DefaultLogger } from "@asenajs/asena/logger";
import { createHonoAdapter } from '@asenajs/hono-adapter';

const [adapter, logger] = createHonoAdapter(new DefaultLogger());

await new AsenaServer(adapter)
  .logger(logger)
  .port(3000)
  .start(true);
```

### Controller Example

```typescript
import { Controller } from '@asenajs/asena/server';
import { Get } from '@asenajs/asena/web';
import type { Context } from '@asenajs/hono-adapter';

@Controller()
export class TestController {
  @Get("/")
  public async me(context: Context) {
    return context.send("Hello World!");
  }
}
```

## API Documentation

### createHonoAdapter(logger, options)

Helper function used to create a Hono adapter.

**Parameters:**
- `logger` (Logger): Logger instance from Asena

**Returns:**
- A tuple with [adapter, logger]

## Testing

Asena Hono Adapter uses Bun's built-in test framework for unit and integration testing.

### Running Tests

```bash
# Run all tests
bun test

# Run tests with watch mode
bun test:watch

# Run tests with coverage report
bun test:coverage
```

### Test Structure

- **Unit Tests**: Test individual components in isolation
  - `HonoAdapter.test.ts` - Tests for the HTTP adapter
  - `HonoContextWrapper.test.ts` - Tests for the context wrapper
  - `HonoWebsocketAdapter.test.ts` - Tests for the WebSocket adapter

- **Integration Tests**: Test how components work together
  - `integration.test.ts` - End-to-end tests for the adapter

### Writing Tests

Example test for a controller:

```typescript
import { describe, expect, it } from "bun:test";
import { AsenaServer } from "@asenajs/asena";
import { createHonoAdapter } from "@asenajs/hono-adapter";
import { DefaultLogger } from "@asenajs/asena/logger";
import { YourController } from "../path/to/your/controller";

describe("YourController", () => {
  let server;
  let baseUrl;
  
  beforeEach(async () => {
    const port = Math.floor(Math.random() * 55000) + 10000;
    const [adapter, logger] = createHonoAdapter(new DefaultLogger());
    const app = new AsenaServer(adapter).logger(logger).port(port);
    
    app.register(YourController);
    
    server = await app.start();
    baseUrl = `http://localhost:${port}`;
  });
  
  afterEach(() => {
    server.stop();
  });
  
  it("should respond correctly", async () => {
    const response = await fetch(`${baseUrl}/your-endpoint`);
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data).toEqual({ /* expected response */ });
  });
});
```

## Development

To run the project in development mode:

```bash
bun run build
```

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.