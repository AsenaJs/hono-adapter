import { dirname, join } from 'node:path';

export const REQUIRE_CHAIN_ENV = 'ASENA_REQUIRE_EXCEPTION_CHAIN';

const FIRST_CORE_WITH_CHAIN = '0.13.0-0';

export const installedCoreVersion = (): string => {
  let directory = dirname(Bun.resolveSync('@asenajs/asena', import.meta.dir));

  while (directory !== dirname(directory)) {
    try {
      const manifest = require(join(directory, 'package.json'));

      if (manifest.name === '@asenajs/asena') {
        return manifest.version;
      }
    } catch {
      // no manifest at this level
    }

    directory = dirname(directory);
  }

  throw new Error('package.json of @asenajs/asena not found');
};

export const chainRequired = ({ coreVersion, flag }: { coreVersion: string; flag?: string }): boolean =>
  flag === '1' || Bun.semver.order(coreVersion, FIRST_CORE_WITH_CHAIN) >= 0;
