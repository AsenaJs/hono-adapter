import { afterEach, describe, expect, it } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '..');
const tempRoots: string[] = [];

const [major, minor, patch] = Bun.version.split('.').map(Number);
const bunFmtAvailable = major > 1 || (major === 1 && (minor > 4 || (minor === 4 && patch >= 4)));

function makeProjectUnderParentConfig(parentConfig: string, sample: string, withScripts = false): string {
  const root = mkdtempSync(join(tmpdir(), 'fmt-config-'));
  tempRoots.push(root);

  const project = join(root, 'project');
  mkdirSync(project);
  writeFileSync(join(root, '.prettierrc.js'), parentConfig);
  copyFileSync(join(repoRoot, 'bunfig.toml'), join(project, 'bunfig.toml'));
  if (withScripts) {
    copyFileSync(join(repoRoot, 'package.json'), join(project, 'package.json'));
  }
  writeFileSync(join(project, 'sample.ts'), sample);

  return project;
}

function run(cwd: string, args: string[]): number {
  return Bun.spawnSync([process.execPath, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' }).exitCode;
}

const formatted = "import { value } from './value';\n\nexport const result = value;\n";
const unformatted = 'const  result = "value"\n';
const multilineObject = 'export const config = {\n  first: 1,\n  second: 2,\n};\n';

describe.skipIf(!bunFmtAvailable)('bun fmt outside Prettier config', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ignores a semi option from a parent Prettier config', () => {
    const project = makeProjectUnderParentConfig('module.exports = { semi: false };\n', formatted);

    expect(run(project, ['fmt', '--check', 'sample.ts'])).toBe(0);
  });

  it('does not skip unformatted files because of a parent requirePragma', () => {
    const project = makeProjectUnderParentConfig('module.exports = { requirePragma: true };\n', unformatted);

    expect(run(project, ['fmt', '--check', 'sample.ts'])).toBe(1);
  });

  it('does not add a pragma because of a parent insertPragma', () => {
    const project = makeProjectUnderParentConfig('module.exports = { insertPragma: true };\n', formatted);

    expect(run(project, ['fmt', '--check', 'sample.ts'])).toBe(0);
  });

  it('format:check ignores a parent objectWrap option', () => {
    const project = makeProjectUnderParentConfig(
      'module.exports = { objectWrap: "collapse" };\n',
      multilineObject,
      true,
    );

    expect(run(project, ['run', 'format:check'])).toBe(0);
  });
});
