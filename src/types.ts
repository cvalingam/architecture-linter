/**
 * Represents the parsed structure of a .context.yml file.
 */
export interface ContextConfig {
  /**
   * A built-in preset name (or list of names) to extend.
   * Supported values: 'nestjs', 'clean-architecture', 'hexagonal', 'nextjs'.
   * User rules override preset rules.
   */
  extends?: string | string[];
  architecture: {
    layers: string[];
  };
  rules: Record<string, LayerRule>;
  /** Project-relative glob patterns for files to exclude from scanning. */
  exclude?: string[];
  /**
   * Manual path alias overrides. Keys are alias prefixes (e.g. '@repositories'),
   * values are project-relative directories (e.g. 'src/repositories').
   * These supplement aliases auto-detected from tsconfig.json compilerOptions.paths.
   */
  aliases?: Record<string, string>;
}

/**
 * Rules applied to a single layer.
 * Use cannot_import OR can_only_import — they are mutually exclusive.
 */
export interface LayerRule {
  /** Blacklist: this layer must not import from any listed layer. */
  cannot_import?: string[];
  /** Whitelist: this layer may only import from listed layers. Any other layer import is a violation. */
  can_only_import?: string[];
  /** Optional file glob (project-relative). Rule only applies to source files matching this pattern. */
  files?: string;
}

/**
 * A single import found in a scanned file.
 * importPath is project-relative (e.g. "repositories/orderRepository").
 * rawSpecifier is the original string in the source (e.g. "../repositories/orderRepository").
 */
export interface ImportInfo {
  file: string;
  importPath: string;
  rawSpecifier: string;
  /** Normalised rule strings suppressed via // arch-ignore: comments on the preceding line. */
  archIgnore: string[];
}

/**
 * The result of scanning a single TypeScript file.
 */
export interface FileScan {
  file: string;
  layer: string | null;
  imports: ImportInfo[];
}

/**
 * A detected architecture rule violation.
 */
export interface Violation {
  file: string;
  importPath: string;
  rawSpecifier: string;
  sourceLayer: string;
  targetLayer: string;
  rule: string;
  /** Textual suggestion for resolving the violation (populated when --fix is enabled). */
  fix?: string;
}

/**
 * Architecture health score returned by the `score` command and included in
 * the `scan --format json` output.
 */
export interface ArchScore {
  /** Overall score 0–100. */
  score: number;
  /** Letter grade derived from the score. */
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  /** Sub-scores that add up to the total. */
  breakdown: {
    /** Violation density contribution (max 60). */
    violations: number;
    /** Layer coverage contribution (max 25). */
    coverage: number;
    /** Rule completeness contribution (max 15). */
    ruleCompleteness: number;
  };
  /** Raw statistics used to derive the score. */
  stats: {
    filesScanned: number;
    totalImports: number;
    violationCount: number;
    classifiedFiles: number;
    unclassifiedFiles: number;
    layersWithRules: number;
    totalLayers: number;
  };
}

/**
 * A circular dependency detected between architectural layers.
 * The `cycle` array traces the path, e.g. ['controller', 'service', 'controller'].
 */
export interface CircularDep {
  cycle: string[];
}

/** Options passed from the CLI to the scan pipeline. */
export interface ScanOptions {
  format: 'text' | 'json' | 'sarif';
  /** Fail and report files that do not belong to any declared layer. */
  strict: boolean;
  /** Suppress informational output; only print violations. */
  quiet: boolean;
  /** Print a why/impact/fix explanation for each violation. */
  explain: boolean;
  /** Re-run the scan automatically when TypeScript files change. */
  watch: boolean;
  /** Show a suggested fix for each violation. */
  fix: boolean;
  /** True when --baseline flag was passed (enables ratchet mode). */
  useBaseline: boolean;
  /** Explicit path to baseline file; when absent the default (.arch-baseline.json) is used. */
  baseline?: string;
  /** When true, overwrite the baseline file with the current violation count. */
  updateBaseline: boolean;
  /** Detect circular dependencies between layers and include them in output. */
  detectCircular: boolean;
}

/** Aggregated result returned by the rule engine. */
export interface RuleCheckResult {
  violations: Violation[];
  /** Populated only in strict mode: files whose directory matches no layer. */
  unclassifiedFiles: string[];
  /** Number of violations per layer name. */
  violationsByLayer: Record<string, number>;
  /** Circular dependencies detected between layers (populated when detectCircular is enabled). */
  circularDeps: CircularDep[];
}
