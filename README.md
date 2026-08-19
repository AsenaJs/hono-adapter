# Asena Hono Adapter

[![Version](https://img.shields.io/badge/version-3.2.0-blue.svg)](https://github.com/AsenaJs/hono-adapter)
[![Bun Version](https://img.shields.io/badge/Bun-1.3.12%2B-blueviolet)](https://bun.sh)

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

- [Bun](https://bun.sh) v1.3.12 or higher
- [@asenajs/asena](https://github.com/AsenaJs/Asena) v0.10.0 or higher (peer dependency)
- [Hono](https://hono.dev) v4.12.9 or higher (peer dependency)
- [Zod](https://zod.dev) v4.3.6 or higher (peer dependency)
- TypeScript v5.8.2 or above

## Installation

```bash
bun add @asenajs/hono-adapter hono zod
```

`hono` and `zod` are **peer dependencies** - this adapter offers the wrapper, your project owns the
libraries it wraps. That is what keeps your code and the adapter on a single copy of `hono`; two
copies mean two `HTTPException` classes, and a deliberate 403 thrown from the wrong one is answered
500.

| Package manager | Command |
|:--|:--|
| bun, npm 7+, pnpm 8+ | `bun add hono zod` — peers auto-install, but declare them anyway so they survive a clean install |
| yarn 1 | `yarn add hono zod` — **required**, yarn 1 does not install peers for you |


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
import { Controller } from '@asenajs/asena/decorators';
import { Get } from '@asenajs/asena/decorators/http';
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

### Form Validation

A `form()` validator validates `multipart/form-data` and `application/x-www-form-urlencoded`
bodies. `zValidator` collapses repeated keys into arrays and applies coercions, so a schema can
declare them as such:

```typescript
import { Controller, Middleware } from '@asenajs/asena/decorators';
import { Post } from '@asenajs/asena/decorators/http';
import { ValidationService, type Context } from '@asenajs/hono-adapter';
import { z } from 'zod';

@Middleware({ validator: true })
export class UploadValidator extends ValidationService {
  form() {
    return z.object({
      title: z.string().min(1),
      tags: z.array(z.string()),
      age: z.coerce.number()
    });
  }
}

@Controller('/uploads')
export class UploadController {
  @Post({ path: '/', validator: UploadValidator })
  public async create(context: Context) {
    // The schema's output - `tags` is an array, `age` a number
    const form = await context.getParseBody();

    return context.send({ created: true }, 201);
  }
}
```

`getParseBody()` returns the schema's output when the route declares a `form` validator. Routes
without one keep the raw `parseBody()` semantics, which are last-value-wins.

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
    // 10000-31999: below the kernel's ephemeral floor (net.ipv4.ip_local_port_range,
    // 32768-60999). A server port drawn from that range collides with the outbound
    // sockets the suite itself holds open - TIME_WAIT included - and Bun.serve then
    // fails with EADDRINUSE, randomly, in whichever test happened to draw it.
    const port = 10000 + Math.floor(Math.random() * 22000);
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