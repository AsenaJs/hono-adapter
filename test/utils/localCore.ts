import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { REQUIRE_CHAIN_ENV } from './coreExceptionChain';

export const CORE_DIR_ENV = 'ASENA_CORE_DIR';

const CORE_NAME = '@asenajs/asena';

export const publishedCopyOf = (installDir: string): string => `${installDir}.published`;

const restorePublishedCopy = (installDir: string) => {
  const publishedCopy = publishedCopyOf(installDir);

  if (existsSync(publishedCopy)) {
    rmSync(installDir, { recursive: true, force: true });
    renameSync(publishedCopy, installDir);
  }
};

const execute = async (command: string[], cwd: string, env?: Record<string, string | undefined>): Promise<number> =>
  Bun.spawn(command, { cwd, env: env ?? process.env, stdio: ['inherit', 'inherit', 'inherit'] }).exited;

const pack = async (coreDir: string, scratch: string): Promise<string> => {
  const manifest = JSON.parse(readFileSync(join(coreDir, 'package.json'), 'utf8'));

  if (manifest.name !== CORE_NAME) {
    throw new Error(`${coreDir} is not a ${CORE_NAME} checkout (package name: ${manifest.name})`);
  }

  if (!existsSync(join(coreDir, manifest.main))) {
    throw new Error(`${coreDir} is not built: ${manifest.main} is missing`);
  }

  const packed = Bun.spawnSync(['bun', 'pm', 'pack', '--destination', scratch, '--ignore-scripts', '--quiet'], {
    cwd: coreDir,
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const tarball = readdirSync(scratch).find((name) => name.endsWith('.tgz'));

  if (packed.exitCode !== 0 || tarball === undefined) {
    throw new Error(`bun pm pack failed in ${coreDir}: ${packed.stderr.toString()}`);
  }

  if ((await execute(['tar', '-xzf', join(scratch, tarball), '-C', scratch], scratch)) !== 0) {
    throw new Error(`could not extract ${tarball}`);
  }

  return join(scratch, 'package');
};

// A packed copy, not a symlink: a link would resolve the checkout's own node_modules and put a
// second reflect-metadata (and a second hono) in the process.
export const withLocalCore = async <T>({
  coreDir,
  installDir,
  run,
}: {
  coreDir: string;
  installDir: string;
  run: () => T | Promise<T>;
}): Promise<T> => {
  restorePublishedCopy(installDir);

  const scratch = mkdtempSync(join(tmpdir(), 'asena-local-core-'));

  try {
    const packed = await pack(resolve(coreDir), scratch);

    renameSync(installDir, publishedCopyOf(installDir));
    cpSync(packed, installDir, { recursive: true });

    return await run();
  } finally {
    restorePublishedCopy(installDir);
    rmSync(scratch, { recursive: true, force: true });
  }
};

if (import.meta.main) {
  const coreDir = process.env[CORE_DIR_ENV];
  const repository = resolve(import.meta.dir, '../..');

  if (!coreDir) {
    console.error(`${CORE_DIR_ENV} must be the path of a built ${CORE_NAME} checkout`);
    process.exit(2);
  }

  // The children get the signal too; staying alive lets the published copy go back.
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => {});

  const exitCode = await withLocalCore({
    coreDir,
    installDir: join(repository, 'node_modules', CORE_NAME),
    run: async () => {
      const typecheck = await execute(['bun', 'run', 'typecheck'], repository);
      const tests = await execute(['bun', 'test', ...process.argv.slice(2)], repository, {
        ...process.env,
        [REQUIRE_CHAIN_ENV]: '1',
      });

      return typecheck || tests;
    },
  });

  process.exit(exitCode);
}
