import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishedCopyOf, withLocalCore } from './utils/localCore';

const writeJson = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));

const versionAt = (directory: string): string =>
  JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).version;

describe('withLocalCore', () => {
  let root: string;
  let coreDir: string;
  let installDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hono-adapter-local-core-'));
    coreDir = join(root, 'checkout');
    installDir = join(root, 'app', 'node_modules', '@asenajs', 'asena');

    mkdirSync(join(coreDir, 'dist'), { recursive: true });
    mkdirSync(join(coreDir, 'node_modules', 'left-behind'), { recursive: true });
    writeJson(join(coreDir, 'package.json'), {
      name: '@asenajs/asena',
      version: '9.9.9',
      main: 'dist/index.js',
      files: ['dist'],
    });
    writeFileSync(join(coreDir, 'dist', 'index.js'), 'export const local = true;\n');
    writeFileSync(join(coreDir, 'node_modules', 'left-behind', 'index.js'), '');

    mkdirSync(installDir, { recursive: true });
    writeJson(join(installDir, 'package.json'), { name: '@asenajs/asena', version: '0.12.0' });
    writeFileSync(join(installDir, 'published.js'), '');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const expectPublishedCopy = () => {
    expect(versionAt(installDir)).toBe('0.12.0');
    expect(existsSync(join(installDir, 'published.js'))).toBe(true);
    expect(readdirSync(join(installDir, '..'))).toEqual(['asena']);
  };

  test('installs the packed checkout for the run and puts the published copy back', async () => {
    const seen = await withLocalCore({
      coreDir,
      installDir,
      run: () => ({
        version: versionAt(installDir),
        built: existsSync(join(installDir, 'dist', 'index.js')),
        published: existsSync(join(installDir, 'published.js')),
        nestedModules: existsSync(join(installDir, 'node_modules')),
      }),
    });

    expect(seen).toEqual({ version: '9.9.9', built: true, published: false, nestedModules: false });
    expectPublishedCopy();
  });

  test('leaves the checkout as it was', async () => {
    const before = readdirSync(coreDir).sort();

    await withLocalCore({ coreDir, installDir, run: () => undefined });

    expect(readdirSync(coreDir).sort()).toEqual(before);
  });

  test('puts the published copy back when the run throws', async () => {
    const failure = new Error('gate failed');

    await expect(
      withLocalCore({
        coreDir,
        installDir,
        run: () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);

    expectPublishedCopy();
  });

  test('recovers the published copy an interrupted run left aside', async () => {
    renameSync(installDir, publishedCopyOf(installDir));
    mkdirSync(installDir);
    writeJson(join(installDir, 'package.json'), { name: '@asenajs/asena', version: '8.8.8' });

    const seen = await withLocalCore({ coreDir, installDir, run: () => versionAt(installDir) });

    expect(seen).toBe('9.9.9');
    expectPublishedCopy();
  });

  test('refuses a directory that is not a core checkout', async () => {
    writeJson(join(coreDir, 'package.json'), { name: 'something-else', version: '1.0.0', main: 'dist/index.js' });

    await expect(withLocalCore({ coreDir, installDir, run: () => undefined })).rejects.toThrow(/@asenajs\/asena/);
    expectPublishedCopy();
  });

  test('refuses a checkout that is not built', async () => {
    rmSync(join(coreDir, 'dist'), { recursive: true });

    await expect(withLocalCore({ coreDir, installDir, run: () => undefined })).rejects.toThrow(/not built/);
    expectPublishedCopy();
  });
});
