import fs from 'fs';
import path from 'path';

export interface BaselineData {
  /** Number of violations recorded when the baseline was saved. */
  violationCount: number;
  /** ISO timestamp of when the baseline was last written. */
  timestamp: string;
  /** Tool version that produced this baseline. */
  version: string;
}

const DEFAULT_BASELINE_FILE = '.arch-baseline.json';

/**
 * Resolves the baseline file path.
 * `basePath` may be absolute or project-relative; defaults to `.arch-baseline.json`.
 */
export function resolveBaselinePath(basePath: string | undefined, projectDir: string): string {
  const p = basePath ?? DEFAULT_BASELINE_FILE;
  return path.isAbsolute(p) ? p : path.join(projectDir, p);
}

/**
 * Reads and parses an existing baseline file.
 * Returns `null` if the file does not exist or cannot be parsed.
 */
export function loadBaseline(baselinePath: string): BaselineData | null {
  if (!fs.existsSync(baselinePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(baselinePath, 'utf-8')) as BaselineData;
  } catch {
    return null;
  }
}

/**
 * Writes a baseline file with the current violation count.
 */
export function saveBaseline(
  baselinePath: string,
  violationCount: number,
  toolVersion: string,
): void {
  const data: BaselineData = {
    violationCount,
    timestamp: new Date().toISOString(),
    version: toolVersion,
  };
  fs.writeFileSync(baselinePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * Returns `true` when the ratchet should fail — i.e. the current violation
 * count has INCREASED beyond the saved baseline.
 * Returns `false` when violations stayed the same or decreased.
 */
export function hasRatchetFailed(currentCount: number, baseline: BaselineData): boolean {
  return currentCount > baseline.violationCount;
}
