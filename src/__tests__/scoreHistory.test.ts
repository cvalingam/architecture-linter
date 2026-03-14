import fs from 'fs';
import os from 'os';
import path from 'path';
import { appendScoreHistory, loadScoreHistory, renderSparkline, ScoreHistoryEntry } from '../scoreHistory';

function makeEntry(score: number, grade: ScoreHistoryEntry['grade'] = 'A'): ScoreHistoryEntry {
  return {
    timestamp: new Date().toISOString(),
    score,
    grade,
    violations: 0,
    version: '0.1.7',
  };
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'score-hist-'));
}

// ── appendScoreHistory / loadScoreHistory ─────────────────────────────────────

describe('appendScoreHistory / loadScoreHistory', () => {
  it('creates the file and appends an entry', () => {
    const dir = tmpDir();
    try {
      appendScoreHistory(dir, makeEntry(80, 'B'));
      const entries = loadScoreHistory(dir);
      expect(entries).toHaveLength(1);
      expect(entries[0].score).toBe(80);
      expect(entries[0].grade).toBe('B');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('appends multiple entries to the same file', () => {
    const dir = tmpDir();
    try {
      appendScoreHistory(dir, makeEntry(70, 'C'));
      appendScoreHistory(dir, makeEntry(85, 'B'));
      appendScoreHistory(dir, makeEntry(95, 'A'));
      const entries = loadScoreHistory(dir);
      expect(entries).toHaveLength(3);
      expect(entries.map(e => e.score)).toEqual([70, 85, 95]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty array when file does not exist', () => {
    const dir = tmpDir();
    try {
      expect(loadScoreHistory(dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tolerates malformed lines in the history file', () => {
    const dir = tmpDir();
    try {
      const filePath = path.join(dir, '.arch-score-history.jsonl');
      fs.writeFileSync(filePath, 'NOT_JSON\n' + JSON.stringify(makeEntry(60)) + '\n', 'utf-8');
      const entries = loadScoreHistory(dir);
      expect(entries).toHaveLength(1);
      expect(entries[0].score).toBe(60);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists all entry fields correctly', () => {
    const dir = tmpDir();
    try {
      const entry = makeEntry(100, 'A');
      entry.violations = 0;
      entry.version = '0.1.7';
      appendScoreHistory(dir, entry);
      const loaded = loadScoreHistory(dir);
      expect(loaded[0]).toMatchObject({ score: 100, grade: 'A', violations: 0, version: '0.1.7' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── renderSparkline ───────────────────────────────────────────────────────────

describe('renderSparkline', () => {
  it('returns empty string for fewer than 2 entries', () => {
    expect(renderSparkline([])).toBe('');
    expect(renderSparkline([makeEntry(80)])).toBe('');
  });

  it('returns a string of the same length as the input', () => {
    const entries = [makeEntry(20), makeEntry(50), makeEntry(80), makeEntry(100)];
    expect(renderSparkline(entries)).toHaveLength(4);
  });

  it('uses only sparkline block characters', () => {
    const entries = [makeEntry(0), makeEntry(25), makeEntry(50), makeEntry(75), makeEntry(100)];
    const sparkline = renderSparkline(entries);
    expect(sparkline).toMatch(/^[▁▂▃▄▅▆▇█]+$/);
  });

  it('renders highest bar for the highest score', () => {
    const entries = [makeEntry(0), makeEntry(100)];
    const sparkline = renderSparkline(entries);
    expect(sparkline[sparkline.length - 1]).toBe('█');
  });

  it('renders lowest bar for the lowest score', () => {
    const entries = [makeEntry(0), makeEntry(50)];
    const sparkline = renderSparkline(entries);
    expect(sparkline[0]).toBe('▁');
  });

  it('all same score renders the same character', () => {
    const entries = [makeEntry(50), makeEntry(50), makeEntry(50)];
    const sparkline = renderSparkline(entries);
    expect(new Set(sparkline.split('')).size).toBe(1);
  });
});
