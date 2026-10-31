<p width="%100" align="center">
  <img src="https://avatars.githubusercontent.com/u/179836938?s=200&v=4" width="150" align="center"/>
</p>

# Asena Hono Adapter

[![Version](https://img.shields.io/npm/v/@asenajs/hono-adapter.svg)](https://asena.sh/docs/adapters/hono)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Bun Version](https://img.shields.io/badge/Bun-1.4%2B-blueviolet)](https://bun.sh)

HTTP and WebSocket adapter for [Asena](https://asena.sh), built on the [Hono](https://hono.dev) web framework.

**Requirements:** Bun 1.4+, `@asenajs/asena` 0.12+, and `hono` + `zod` as peer dependencies your project installs.

## Installation

```bash
bun add @asenajs/asena @asenajs/hono-adapter @asenajs/asena-logger hono zod
```

## Usage

```typescript
// src/index.ts
import { AsenaServerFactory } from '@asenajs/asena';
import { Controller } from '@asenajs/asena/decorators';
import { Get } from '@asenajs/asena/decorators/http';
import { createHonoAdapter, type Context } from '@asenajs/hono-adapter';
import { AsenaLogger } from '@asenajs/asena-logger';

@Controller('/')
class HelloController {
  @Get('/')
  async hello(context: Context) {
    return context.send('Hello World!');
  }
}

const [adapter, logger] = createHonoAdapter({ logger: new AsenaLogger() });

const server = await AsenaServerFactory.create({
  adapter,
  logger,
  port: 3000,
  components: [HelloController],
});

await server.start();
```

## Documentation

Full documentation: [asena.sh/docs/adapters/hono](https://asena.sh/docs/adapters/hono)

## Contributing

Contributions are welcome! Submit a Pull Request on [GitHub](https://github.com/AsenaJs/hono-adapter).

## License

MIT License - see [LICENSE](LICENSE) file.

## Support

Issues or questions? Open an issue on [GitHub](https://github.com/AsenaJs/hono-adapter/issues).
