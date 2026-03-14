/**
 * Score history tracking: append, load, and render a sparkline of arch health scores.
 *
 * History is stored as newline-delimited JSON (`.arch-score-history.jsonl`) — one
 * JSON object per line, each containing timestamp, score, grade, and violation count.
 */

import fs from 'fs';
import path from 'path';

export interface ScoreHistoryEntry {
  timestamp: string;       // ISO 8601
  score: number;           // 0–100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  violations: number;
  version: string;         // tool version that produced the entry
}

const HISTORY_FILENAME = '.arch-score-history.jsonl';
const SPARKLINE_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/**
 * Appends a new score entry to the history file in `dir`.
 * Creates the file if it does not exist.
 */
export function appendScoreHistory(dir: string, entry: ScoreHistoryEntry): void {
  const filePath = path.join(dir, HISTORY_FILENAME);
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
}

/**
 * Loads all score history entries from `dir`.
 * Returns an empty array if the file does not exist or is unreadable.
 */
export function loadScoreHistory(dir: string): ScoreHistoryEntry[] {
  const filePath = path.join(dir, HISTORY_FILENAME);
  if (!fs.existsSync(filePath)) return [];

  const entries: ScoreHistoryEntry[] = [];
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as ScoreHistoryEntry);
    } catch {
      // Skip malformed lines silently
    }
  }
  return entries;
}

/**
 * Returns a sparkline string for the given score history entries.
 * Each entry is represented by a single block character (▁–█) proportional to its score.
 * Returns an empty string when fewer than 2 entries are provided.
 */
export function renderSparkline(entries: ScoreHistoryEntry[]): string {
  if (entries.length < 2) return '';

  const scores = entries.map(e => e.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1; // avoid division by zero

  return scores
    .map(score => {
      const index = Math.min(
        Math.floor(((score - min) / range) * SPARKLINE_CHARS.length),
        SPARKLINE_CHARS.length - 1,
      );
      return SPARKLINE_CHARS[index];
    })
    .join('');
}
