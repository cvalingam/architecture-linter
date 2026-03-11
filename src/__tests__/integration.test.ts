/**
 * Integration tests for the architecture-linter CLI.
 *
 * These tests invoke the compiled `dist/cli.js` via child_process and verify
 * real end-to-end behaviour.  Run `npm run build` before executing this suite.
 */

import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

// ── paths ─────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'dist', 'cli.js');
const EXAMPLES = path.join(ROOT, 'examples');
const SAMPLE_PROJECT = path.join(EXAMPLES, 'sample-project');
const SAMPLE_CONTEXT = path.join(EXAMPLES, 'sample.context.yml');
const ALIAS_TEST = path.join(EXAMPLES, 'alias-test');

// Disable chalk colours so assertions work on raw strings
const ENV = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' };

// ── helper ────────────────────────────────────────────────────────────────────

function run(args: string[]): { stdout: string; stderr: string; status: number } {
  const r = spawnSync('node', [CLI, ...args], { encoding: 'utf-8', env: ENV });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? 1,
  };
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'arch-int-'));
}

// ── guard ─────────────────────────────────────────────────────────────────────

beforeAll(() => {
  if (!fs.existsSync(CLI)) {
    throw new Error(
      `dist/cli.js not found at ${CLI}.\n` +
        'Run `npm run build` before executing the integration test suite.'
    );
  }
});

// ── scan - violation detection ────────────────────────────────────────────────

describe('scan - violation detection', () => {
  it('detects violation in sample-project and exits with code 1', () => {
    const r = run(['scan', '-p', SAMPLE_PROJECT, '-c', SAMPLE_CONTEXT]);
    expect(r.status).toBe(1);
    expect(r.stdout.toLowerCase()).toContain('violation');
  });

  it('reports the correct rule in the output', () => {
    const r = run(['scan', '-p', SAMPLE_PROJECT, '-c', SAMPLE_CONTEXT]);
    expect(r.stdout).toMatch(/Controller cannot import Repository/i);
  });

  it('clean project exits with code 0', () => {
    const dir = tmpDir();
    try {
      fs.mkdirSync(path.join(dir, 'controllers'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'services'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'controllers', 'ctrl.ts'),
        `import { S } from '../services/svc';\nexport class C { constructor(private s: S) {} }`
      );
      fs.writeFileSync(path.join(dir, 'services', 'svc.ts'), 'export class S {}');
      fs.writeFileSync(
        path.join(dir, '.context.yml'),
        'architecture:\n  layers:\n    - controller\n    - service\nrules:\n  controller:\n    cannot_import:\n      - repository\n'
      );
      const r = run(['scan', '-p', dir]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('No architecture violations');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── scan - --fix flag ─────────────────────────────────────────────────────────

describe('scan --fix', () => {
  it('shows "Suggested fix" in text output', () => {
    const r = run(['scan', '-p', SAMPLE_PROJECT, '-c', SAMPLE_CONTEXT, '--fix']);
    expect(r.stdout).toContain('Suggested fix');
  });

  it('mentions an allowed intermediary layer in the fix message', () => {
    const r = run(['scan', '-p', SAMPLE_PROJECT, '-c', SAMPLE_CONTEXT, '--fix']);
    expect(r.stdout).toContain("'service'");
  });

  it('includes a non-empty fix field in JSON output', () => {
    const r = run(['scan', '-p', SAMPLE_PROJECT, '-c', SAMPLE_CONTEXT, '--fix', '--format', 'json']);
    const json = JSON.parse(r.stdout);
    expect(json.violations[0].fix).toBeTruthy();
    expect(json.violations[0].fix).toContain("'service'");
  });
});

// ── scan - --explain flag ─────────────────────────────────────────────────────

describe('scan --explain', () => {
  it('shows why/impact/fix sections in text output', () => {
    const r = run(['scan', '-p', SAMPLE_PROJECT, '-c', SAMPLE_CONTEXT, '--explain']);
    expect(r.stdout).toContain('Why this matters');
    expect(r.stdout).toContain('Impact');
    expect(r.stdout).toContain('How to fix');
  });

  it('includes explanation object in JSON output', () => {
    const r = run(['scan', '-p', SAMPLE_PROJECT, '-c', SAMPLE_CONTEXT, '--explain', '--format', 'json']);
    const json = JSON.parse(r.stdout);
    expect(json.violations[0].explanation).toBeDefined();
    expect(json.violations[0].explanation.why).toBeTruthy();
    expect(json.violations[0].explanation.fix).toBeTruthy();
  });

  it('combines --explain and --fix in JSON without conflicts', () => {
    const r = run([
      'scan', '-p', SAMPLE_PROJECT, '-c', SAMPLE_CONTEXT,
      '--explain', '--fix', '--format', 'json',
    ]);
    const json = JSON.parse(r.stdout);
    const v = json.violations[0];
    expect(v.fix).toBeTruthy();
    expect(v.explanation.why).toBeTruthy();
  });
});

// ── scan - --format json ──────────────────────────────────────────────────────

describe('scan --format json', () => {
  it('produces valid JSON', () => {
    const r = run(['scan', '-p', SAMPLE_PROJECT, '-c', SAMPLE_CONTEXT, '--format', 'json']);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  it('has the expected top-level shape', () => {
    const r = run(['scan', '-p', SAMPLE_PROJECT, '-c', SAMPLE_CONTEXT, '--format', 'json']);
    const json = JSON.parse(r.stdout);
    expect(json).toHaveProperty('filesScanned');
    expect(json).toHaveProperty('violations');
    expect(json).toHaveProperty('violationsByLayer');
    expect(json).toHaveProperty('unclassifiedFiles');
  });

  it('reports the correct violation count', () => {
    const r = run(['scan', '-p', SAMPLE_PROJECT, '-c', SAMPLE_CONTEXT, '--format', 'json']);
    const json = JSON.parse(r.stdout);
    expect(json.violations.length).toBeGreaterThanOrEqual(1);
  });

  it('violation entry has required fields', () => {
    const r = run(['scan', '-p', SAMPLE_PROJECT, '-c', SAMPLE_CONTEXT, '--format', 'json']);
    const json = JSON.parse(r.stdout);
    const v = json.violations[0];
    expect(v).toHaveProperty('file');
    expect(v).toHaveProperty('sourceLayer');
    expect(v).toHaveProperty('targetLayer');
    expect(v).toHaveProperty('rule');
  });
});

// ── scan - --quiet flag ───────────────────────────────────────────────────────

describe('scan --quiet', () => {
  it('suppresses the "Scanning project" header', () => {
    const r = run(['scan', '-p', SAMPLE_PROJECT, '-c', SAMPLE_CONTEXT, '--quiet']);
    expect(r.stdout).not.toContain('Scanning project');
  });

  it('still reports violations even in quiet mode', () => {
    const r = run(['scan', '-p', SAMPLE_PROJECT, '-c', SAMPLE_CONTEXT, '--quiet']);
    expect(r.stdout.toLowerCase()).toContain('violation');
  });
});

// ── scan - --strict flag ──────────────────────────────────────────────────────

describe('scan --strict', () => {
  it('exits 1 when there are unclassified files', () => {
    const dir = tmpDir();
    try {
      fs.mkdirSync(path.join(dir, 'controllers'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'controllers', 'ctrl.ts'), 'export class C {}');
      // random.ts is not in any known layer
      fs.writeFileSync(path.join(dir, 'random.ts'), 'export const x = 1;');
      fs.writeFileSync(
        path.join(dir, '.context.yml'),
        'architecture:\n  layers:\n    - controller\nrules: {}\n'
      );
      const r = run(['scan', '-p', dir, '--strict']);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('Unclassified');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── scan - missing config ─────────────────────────────────────────────────────

describe('scan - missing config', () => {
  it('shows a helpful error and exits 1 when no .context.yml can be found', () => {
    const dir = tmpDir();
    try {
      const r = run(['scan', '-p', dir]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('.context.yml');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── scan - alias resolution ───────────────────────────────────────────────────

describe('scan - alias resolution', () => {
  it('detects violation imported via a @-alias and exits 1', () => {
    const r = run(['scan', '-p', ALIAS_TEST]);
    expect(r.status).toBe(1);
  });

  it('correctly identifies the source and target layers in alias violation', () => {
    const r = run(['scan', '-p', ALIAS_TEST]);
    expect(r.stdout).toMatch(/Controller cannot import Repository/i);
  });
});

// ── scan - framework preset ───────────────────────────────────────────────────

describe('scan - framework preset', () => {
  it('nestjs preset detects controller→repository violation in a temp project', () => {
    const dir = tmpDir();
    try {
      fs.mkdirSync(path.join(dir, 'controllers'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'repositories'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'controllers', 'ctrl.ts'),
        `import { Repo } from '../repositories/repo';\nexport class C {}`
      );
      fs.writeFileSync(path.join(dir, 'repositories', 'repo.ts'), 'export class Repo {}');
      fs.writeFileSync(
        path.join(dir, '.context.yml'),
        'extends: nestjs\narchitecture:\n  layers: []\nrules: {}\n'
      );
      const r = run(['scan', '-p', dir]);
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/Controller cannot import Repository/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('clean-architecture preset loads without error', () => {
    const dir = tmpDir();
    try {
      fs.mkdirSync(path.join(dir, 'entity'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'entity', 'order.ts'), 'export class Order {}');
      fs.writeFileSync(
        path.join(dir, '.context.yml'),
        'extends: clean-architecture\narchitecture:\n  layers: []\nrules: {}\n'
      );
      const r = run(['scan', '-p', dir]);
      // No rule violations; exit code 0
      expect(r.status).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports unknown preset with a helpful error and exits 1', () => {
    const dir = tmpDir();
    try {
      fs.mkdirSync(path.join(dir, 'controllers'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'controllers', 'ctrl.ts'), 'export class C {}');
      fs.writeFileSync(
        path.join(dir, '.context.yml'),
        'extends: no-such-preset\narchitecture:\n  layers:\n    - controller\nrules: {}\n'
      );
      const r = run(['scan', '-p', dir]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('Unknown preset');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('error message lists available preset names', () => {
    const dir = tmpDir();
    try {
      fs.writeFileSync(
        path.join(dir, '.context.yml'),
        'extends: not-a-preset\narchitecture:\n  layers:\n    - controller\nrules: {}\n'
      );
      const r = run(['scan', '-p', dir]);
      expect(r.stderr).toContain('nestjs');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── ci command ────────────────────────────────────────────────────────────────

describe('ci command', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('creates .github/workflows/arch-lint.yml on the first run', () => {
    const r = run(['ci', '-p', dir]);
    expect(r.status).toBe(0);
    const wf = path.join(dir, '.github', 'workflows', 'arch-lint.yml');
    expect(fs.existsSync(wf)).toBe(true);
  });

  it('generated workflow contains architecture-linter scan command', () => {
    run(['ci', '-p', dir]);
    const wf = path.join(dir, '.github', 'workflows', 'arch-lint.yml');
    const content = fs.readFileSync(wf, 'utf-8');
    expect(content).toContain('architecture-linter scan');
  });

  it('generated workflow references actions/checkout', () => {
    run(['ci', '-p', dir]);
    const wf = path.join(dir, '.github', 'workflows', 'arch-lint.yml');
    const content = fs.readFileSync(wf, 'utf-8');
    expect(content).toContain('actions/checkout');
  });

  it('errors with exit code 1 on unknown platform', () => {
    const r = run(['ci', '--platform', 'bitbucket']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Unknown platform');
    expect(r.stderr).toContain('github');
  });

  it('errors when workflow file already exists', () => {
    run(['ci', '-p', dir]); // first run succeeds
    const r = run(['ci', '-p', dir]); // second run should fail
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('already exists');
  });
});

// ── init command ──────────────────────────────────────────────────────────────

describe('init command', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('creates .context.yml in the project directory', () => {
    fs.mkdirSync(path.join(dir, 'controllers'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'services'), { recursive: true });
    const r = run(['init', '-p', dir]);
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(dir, '.context.yml'))).toBe(true);
  });

  it('auto-detects controller / service / repository layers from directory names', () => {
    fs.mkdirSync(path.join(dir, 'controllers'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'services'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'repositories'), { recursive: true });
    run(['init', '-p', dir]);
    const content = fs.readFileSync(path.join(dir, '.context.yml'), 'utf-8');
    expect(content).toContain('controller');
    expect(content).toContain('service');
    expect(content).toContain('repository');
  });

  it('exits 1 when .context.yml already exists', () => {
    fs.writeFileSync(path.join(dir, '.context.yml'), 'pre-existing');
    const r = run(['init', '-p', dir]);
    expect(r.status).toBe(1);
  });

  it('generated .context.yml contains an architecture section', () => {
    run(['init', '-p', dir]);
    const content = fs.readFileSync(path.join(dir, '.context.yml'), 'utf-8');
    expect(content).toContain('architecture:');
    expect(content).toContain('layers:');
  });
});
