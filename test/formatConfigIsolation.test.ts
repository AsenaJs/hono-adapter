import { afterEach, describe, expect, it } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '..');
const tempRoots: string[] = [];

function makeProjectUnderPrettierConfig(parentConfig: string): string {
  const root = mkdtempSync(join(tmpdir(), 'fmt-config-'));
  tempRoots.push(root);

  const project = join(root, 'project');
  mkdirSync(project);
  writeFileSync(join(root, '.prettierrc.js'), parentConfig);
  copyFileSync(join(repoRoot, 'bunfig.toml'), join(project, 'bunfig.toml'));
  writeFileSync(join(project, 'sample.ts'), "import { value } from './value';\n\nexport const result = value;\n");

  return project;
}

describe('bun fmt outside Prettier config', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ignores a Prettier config in a parent directory', () => {
    const project = makeProjectUnderPrettierConfig('module.exports = { semi: false };\n');

    const result = Bun.spawnSync([process.execPath, 'fmt', '--check', 'sample.ts'], {
      cwd: project,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(result.exitCode).toBe(0);
  });
});
