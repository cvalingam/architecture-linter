import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  BaselineData,
  hasRatchetFailed,
  loadBaseline,
  resolveBaselinePath,
  saveBaseline,
} from '../baseline';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'arch-baseline-'));
}

describe('resolveBaselinePath', () => {
  it('uses the default filename when no path is provided', () => {
    const result = resolveBaselinePath(undefined, '/project');
    expect(result).toBe(path.join('/project', '.arch-baseline.json'));
  });

  it('joins a relative path with the project dir', () => {
    const result = resolveBaselinePath('baselines/arch.json', '/project');
    expect(result).toBe(path.join('/project', 'baselines/arch.json'));
  });

  it('returns an absolute path unchanged', () => {
    const abs = path.resolve('/tmp/my-baseline.json');
    expect(resolveBaselinePath(abs, '/project')).toBe(abs);
  });
});

describe('loadBaseline', () => {
  it('returns null when file does not exist', () => {
    expect(loadBaseline('/nonexistent/path/baseline.json')).toBeNull();
  });

  it('returns null when file contains invalid JSON', () => {
    const dir = tmpDir();
    const p = path.join(dir, 'baseline.json');
    fs.writeFileSync(p, 'not json', 'utf-8');
    expect(loadBaseline(p)).toBeNull();
    fs.rmSync(dir, { recursive: true });
  });

  it('correctly parses a valid baseline file', () => {
    const dir = tmpDir();
    const p = path.join(dir, 'baseline.json');
    const data: BaselineData = { violationCount: 5, timestamp: '2024-01-01T00:00:00Z', version: '0.1.0' };
    fs.writeFileSync(p, JSON.stringify(data), 'utf-8');
    const loaded = loadBaseline(p);
    expect(loaded).not.toBeNull();
    expect(loaded!.violationCount).toBe(5);
    fs.rmSync(dir, { recursive: true });
  });
});

describe('saveBaseline', () => {
  it('writes a parseable JSON file', () => {
    const dir = tmpDir();
    const p = path.join(dir, 'baseline.json');
    saveBaseline(p, 3, '0.1.5');
    const raw = fs.readFileSync(p, 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
    fs.rmSync(dir, { recursive: true });
  });

  it('stores the correct violation count', () => {
    const dir = tmpDir();
    const p = path.join(dir, 'baseline.json');
    saveBaseline(p, 7, '0.1.5');
    const data = JSON.parse(fs.readFileSync(p, 'utf-8')) as BaselineData;
    expect(data.violationCount).toBe(7);
    fs.rmSync(dir, { recursive: true });
  });

  it('stores the tool version', () => {
    const dir = tmpDir();
    const p = path.join(dir, 'baseline.json');
    saveBaseline(p, 0, '1.2.3');
    const data = JSON.parse(fs.readFileSync(p, 'utf-8')) as BaselineData;
    expect(data.version).toBe('1.2.3');
    fs.rmSync(dir, { recursive: true });
  });

  it('stores a valid ISO timestamp', () => {
    const dir = tmpDir();
    const p = path.join(dir, 'baseline.json');
    saveBaseline(p, 0, '0.1.5');
    const data = JSON.parse(fs.readFileSync(p, 'utf-8')) as BaselineData;
    expect(new Date(data.timestamp).getTime()).not.toBeNaN();
    fs.rmSync(dir, { recursive: true });
  });

  it('overwrites an existing baseline file', () => {
    const dir = tmpDir();
    const p = path.join(dir, 'baseline.json');
    saveBaseline(p, 10, '0.1.5');
    saveBaseline(p, 2, '0.1.5');
    const data = JSON.parse(fs.readFileSync(p, 'utf-8')) as BaselineData;
    expect(data.violationCount).toBe(2);
    fs.rmSync(dir, { recursive: true });
  });
});

describe('hasRatchetFailed', () => {
  const baseline: BaselineData = { violationCount: 5, timestamp: '', version: '0.1.0' };

  it('returns true when violations increased', () => {
    expect(hasRatchetFailed(6, baseline)).toBe(true);
  });

  it('returns false when violations stayed the same', () => {
    expect(hasRatchetFailed(5, baseline)).toBe(false);
  });

  it('returns false when violations decreased', () => {
    expect(hasRatchetFailed(3, baseline)).toBe(false);
  });

  it('returns false when violations drop to 0', () => {
    expect(hasRatchetFailed(0, baseline)).toBe(false);
  });

  it('returns true even for a single-violation increase', () => {
    expect(hasRatchetFailed(baseline.violationCount + 1, baseline)).toBe(true);
  });
});
