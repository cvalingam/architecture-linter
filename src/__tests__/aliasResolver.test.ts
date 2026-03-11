import path from 'path';
import fs from 'fs';
import os from 'os';
import { loadTsConfigAliases, mergeAliases, resolveAlias } from '../aliasResolver';

// ── helpers ───────────────────────────────────────────────────────────────────

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'arch-alias-test-'));
}

// ── loadTsConfigAliases ───────────────────────────────────────────────────────

describe('loadTsConfigAliases', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('returns empty map when tsconfig.json does not exist', () => {
    expect(loadTsConfigAliases(dir)).toEqual({});
  });

  it('parses paths from tsconfig.json', () => {
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@repositories/*': ['src/repositories/*'],
            '@services/*': ['src/services/*'],
          },
        },
      }),
    );
    const aliases = loadTsConfigAliases(dir);
    expect(aliases['@repositories']).toBe(path.resolve(dir, 'src/repositories'));
    expect(aliases['@services']).toBe(path.resolve(dir, 'src/services'));
  });

  it('handles tsconfig.json written with a UTF-8 BOM', () => {
    const json = '\uFEFF' + JSON.stringify({
      compilerOptions: {
        baseUrl: '.',
        paths: { '@domain/*': ['src/domain/*'] },
      },
    });
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), json);
    const aliases = loadTsConfigAliases(dir);
    expect(aliases['@domain']).toBe(path.resolve(dir, 'src/domain'));
  });

  it('returns empty map on malformed JSON', () => {
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{ bad json !!');
    expect(loadTsConfigAliases(dir)).toEqual({});
  });

  it('handles exact alias with no wildcard', () => {
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@config': ['src/config/index'] } } }),
    );
    const aliases = loadTsConfigAliases(dir);
    expect(aliases['@config']).toBe(path.resolve(dir, 'src/config/index'));
  });

  it('uses project root as baseUrl when compilerOptions.baseUrl is omitted', () => {
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { paths: { '@lib/*': ['lib/*'] } } }),
    );
    const aliases = loadTsConfigAliases(dir);
    expect(aliases['@lib']).toBe(path.resolve(dir, 'lib'));
  });

  it('strips tsconfig // line comments before parsing', () => {
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      `{
  // A comment
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["src/shared/*"]
    }
  }
}`,
    );
    const aliases = loadTsConfigAliases(dir);
    expect(aliases['@shared']).toBe(path.resolve(dir, 'src/shared'));
  });

  it('returns empty map when tsconfig has no compilerOptions', () => {
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ include: ['src/**'] }));
    expect(loadTsConfigAliases(dir)).toEqual({});
  });

  it('returns empty map when compilerOptions has no paths', () => {
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }));
    expect(loadTsConfigAliases(dir)).toEqual({});
  });

  it('skips alias entries with empty targets array', () => {
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { paths: { '@foo/*': [], '@bar/*': ['src/bar/*'] } } }),
    );
    const aliases = loadTsConfigAliases(dir);
    expect(aliases['@foo']).toBeUndefined();
    expect(aliases['@bar']).toBeDefined();
  });
});

// ── resolveAlias ──────────────────────────────────────────────────────────────

describe('resolveAlias', () => {
  const projectDir = '/project';
  const aliases: Record<string, string> = {
    '@repositories': '/project/src/repositories',
    '@services': '/project/src/services',
  };

  it('resolves wildcard alias import', () => {
    expect(resolveAlias('@repositories/orderRepository', aliases, projectDir))
      .toBe('src/repositories/orderRepository');
  });

  it('resolves exact alias match (no trailing path segment)', () => {
    expect(resolveAlias('@services', aliases, projectDir)).toBe('src/services');
  });

  it('returns null for unrecognised node_modules specifier', () => {
    expect(resolveAlias('lodash', aliases, projectDir)).toBeNull();
    expect(resolveAlias('@nestjs/common', aliases, projectDir)).toBeNull();
  });

  it('returns null when the alias map is empty', () => {
    expect(resolveAlias('@repositories/something', {}, projectDir)).toBeNull();
  });

  it('does not match a prefix that is only a substring of the alias key', () => {
    // '@repo' should not match '@repositories'
    const narrowAliases = { '@repo': '/project/src/repo' };
    expect(resolveAlias('@repositories/x', narrowAliases, projectDir)).toBeNull();
  });
});

// ── mergeAliases ──────────────────────────────────────────────────────────────

describe('mergeAliases', () => {
  it('combines tsconfig aliases with manual config aliases', () => {
    const projectDir = path.resolve('/project');
    const tsconfig = { '@repos': '/abs/repos' };
    const manual = { '@manual': 'src/manual' };
    const result = mergeAliases(tsconfig, manual, projectDir);
    expect(result['@repos']).toBe('/abs/repos');
    // manual values are resolved relative to projectDir — use path.resolve for platform safety
    expect(result['@manual']).toBe(path.resolve(projectDir, 'src/manual'));
  });

  it('manual aliases override tsconfig aliases for the same key', () => {
    const projectDir = path.resolve('/project');
    const tsconfig = { '@shared': '/old/path' };
    const manual = { '@shared': 'new/path' };
    const result = mergeAliases(tsconfig, manual, projectDir);
    expect(result['@shared']).toBe(path.resolve(projectDir, 'new/path'));
  });

  it('handles undefined manual aliases without throwing', () => {
    const tsconfig = { '@repos': '/abs/repos' };
    expect(mergeAliases(tsconfig, undefined, '/project')).toEqual(tsconfig);
  });
});
