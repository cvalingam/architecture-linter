import { ArchScore, ContextConfig, FileScan, RuleCheckResult } from './types';

/**
 * Calculates an architecture health score (0–100) from a completed scan.
 *
 * The score has three components:
 *  - Violation density  (0–60 pts): how few violations exist relative to total imports.
 *  - Layer coverage     (0–25 pts): what fraction of files belong to a declared layer.
 *  - Rule completeness  (0–15 pts): what fraction of layers have at least one rule defined.
 */
export function calculateScore(
  scans: FileScan[],
  result: RuleCheckResult,
  config: ContextConfig,
): ArchScore {
  const filesScanned = scans.length;
  const totalImports = scans.reduce((sum, f) => sum + f.imports.length, 0);
  const violationCount = result.violations.length;
  const unclassifiedCount = result.unclassifiedFiles.length;
  const classifiedFiles = filesScanned - unclassifiedCount;
  const totalLayers = config.architecture.layers.length;
  const layersWithRules = config.architecture.layers.filter(layer => {
    const rule = config.rules?.[layer];
    if (!rule) return false;
    return (rule.cannot_import !== undefined && rule.cannot_import.length > 0)
      || rule.can_only_import !== undefined;
  }).length;

  // 1. Violation density score (0–60)
  const violationScore = totalImports === 0
    ? 60
    : Math.max(0, (1 - violationCount / totalImports)) * 60;

  // 2. Layer coverage score (0–25)
  const coverageScore = filesScanned === 0
    ? 25
    : (classifiedFiles / filesScanned) * 25;

  // 3. Rule completeness score (0–15)
  const ruleScore = totalLayers === 0
    ? 15
    : (layersWithRules / totalLayers) * 15;

  const score = Math.min(100, Math.round(violationScore + coverageScore + ruleScore));

  const grade: ArchScore['grade'] =
    score >= 90 ? 'A' :
    score >= 75 ? 'B' :
    score >= 60 ? 'C' :
    score >= 40 ? 'D' : 'F';

  return {
    score,
    grade,
    breakdown: {
      violations: Math.round(violationScore),
      coverage: Math.round(coverageScore),
      ruleCompleteness: Math.round(ruleScore),
    },
    stats: {
      filesScanned,
      totalImports,
      violationCount,
      classifiedFiles,
      unclassifiedFiles: unclassifiedCount,
      layersWithRules,
      totalLayers,
    },
  };
}
