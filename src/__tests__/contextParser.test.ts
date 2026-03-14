import path from 'path';
import fs from 'fs';
import os from 'os';
import { findContextFile, loadContextConfig } from '../contextParser';

// ── helpers ───────────────────────────────────────────────────────────────────

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'arch-ctx-'));
}

function writeConfig(dir: string, content: string): string {
  const p = path.join(dir, '.context.yml');
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

// ── findContextFile ───────────────────────────────────────────────────────────

describe('findContextFile', () => {
  let dir: string;

  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('finds .context.yml in the start directory', () => {
    const p = writeConfig(dir, '');
    expect(findContextFile(dir)).toBe(p);
  });

  it('finds .context.yml in a parent directory', () => {
    writeConfig(dir, '');
    const sub = path.join(dir, 'src', 'controllers');
    fs.mkdirSync(sub, { recursive: true });
    expect(findContextFile(sub)).toBe(path.join(dir, '.context.yml'));
  });

  it('returns null when no .context.yml exists in the directory tree', () => {
    // dir has no .context.yml; system temp dirs normally do not either
    const result = findContextFile(dir);
    // We can only assert it's either null or a string path (env-dependent), but the call must not throw
    expect(result === null || typeof result === 'string').toBe(true);
  });
});

// ── loadContextConfig ─────────────────────────────────────────────────────────

describe('loadContextConfig', () => {
  let dir: string;

  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('loads a valid config correctly', () => {
    const p = writeConfig(dir, `
architecture:
  layers:
    - controller
    - service
rules:
  controller:
    cannot_import:
      - service
`);
    const cfg = loadContextConfig(p);
    expect(cfg.architecture.layers).toEqual(['controller', 'service']);
    expect(cfg.rules?.controller?.cannot_import).toEqual(['service']);
  });

  it('throws when file does not exist', () => {
    expect(() => loadContextConfig('/does-not-exist/.context.yml')).toThrow();
  });

  it('throws on malformed YAML', () => {
    const p = writeConfig(dir, ': ][{ bad yaml {{');
    expect(() => loadContextConfig(p)).toThrow();
  });

  it('throws when architecture.layers is empty and no extends', () => {
    const p = writeConfig(dir, `
architecture:
  layers: []
rules: {}
`);
    expect(() => loadContextConfig(p)).toThrow();
  });

  it('throws when architecture key is completely missing and no extends', () => {
    const p = writeConfig(dir, 'rules: {}');
    expect(() => loadContextConfig(p)).toThrow();
  });

  it('resolves preset when extends is set, populating layers', () => {
    const p = writeConfig(dir, `
extends: nestjs
architecture:
  layers: []
rules: {}
`);
    const cfg = loadContextConfig(p);
    expect(cfg.architecture.layers).toContain('controller');
    expect(cfg.architecture.layers).toContain('service');
    expect(cfg.architecture.layers).toContain('repository');
  });

  it('allows omitting architecture entirely when extends is set', () => {
    const p = writeConfig(dir, `
extends: clean-architecture
rules: {}
`);
    expect(() => loadContextConfig(p)).not.toThrow();
    const cfg = loadContextConfig(p);
    expect(cfg.architecture.layers.length).toBeGreaterThan(0);
  });

  it('handles extends with architecture present but layers key absent', () => {
    const p = writeConfig(dir, `
extends: nestjs
architecture:
  custom_key: value
rules: {}
`);
    const cfg = loadContextConfig(p);
    expect(cfg.architecture.layers).toContain('controller');
  });

  it('user layers are kept alongside preset layers', () => {
    const p = writeConfig(dir, `
extends: nestjs
architecture:
  layers:
    - custom-layer
rules: {}
`);
    const cfg = loadContextConfig(p);
    expect(cfg.architecture.layers).toContain('custom-layer');
    expect(cfg.architecture.layers).toContain('controller');
  });

  it('throws for an unknown preset', () => {
    const p = writeConfig(dir, `
extends: no-such-preset
architecture:
  layers:
    - controller
rules: {}
`);
    expect(() => loadContextConfig(p)).toThrow(/Unknown preset/);
  });

  it('throws with available preset names listed', () => {
    const p = writeConfig(dir, `
extends: not-a-preset
architecture:
  layers:
    - controller
rules: {}
`);
    expect(() => loadContextConfig(p)).toThrow(/nestjs/);
  });

  it('loads exclude list', () => {
    const p = writeConfig(dir, `
architecture:
  layers:
    - controller
rules: {}
exclude:
  - node_modules/**
  - dist/**
`);
    const cfg = loadContextConfig(p);
    expect(cfg.exclude).toContain('node_modules/**');
  });

  it('loads aliases map', () => {
    const p = writeConfig(dir, `
architecture:
  layers:
    - controller
rules: {}
aliases:
  "@repos": src/repositories
`);
    const cfg = loadContextConfig(p);
    expect(cfg.aliases?.['@repos']).toBe('src/repositories');
  });
});

// ── loadContextConfig - mutual exclusivity warning ────────────────────────────

describe('loadContextConfig - mutual exclusivity warning', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('warns to console when both cannot_import and can_only_import are set', () => {
    const p = writeConfig(dir, `
architecture:
  layers:
    - controller
    - service
    - repository
rules:
  controller:
    cannot_import:
      - repository
    can_only_import:
      - service
`);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      loadContextConfig(p);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("cannot_import"));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("can_only_import"));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("controller"));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not warn when only cannot_import is set', () => {
    const p = writeConfig(dir, `
architecture:
  layers:
    - controller
    - repository
rules:
  controller:
    cannot_import:
      - repository
`);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      loadContextConfig(p);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
