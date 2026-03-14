#!/usr/bin/env node
/**
 * architecture-linter CLI
 *
 * Commands:
 *   scan   Scan the project for architecture violations
 *   init   Generate a starter .context.yml from the project's folder structure
 *   ci     Generate a CI workflow file for architecture linting
 *   score  Calculate architecture health score
 *   badge  Generate a shields.io badge for the health score
 */

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { Command } from 'commander';
import { findContextFile, loadContextConfig } from './contextParser';
import { scanProject } from './dependencyScanner';
import { explain } from './explainer';
import { checkRules } from './ruleEngine';
import { calculateScore } from './scorer';
import { toSarif } from './sarifFormatter';
import { detectCircularDependencies } from './circularDetector';
import { resolveBaselinePath, loadBaseline, saveBaseline, hasRatchetFailed } from './baseline';
import { discoverWorkspacePackages } from './monorepo';
import { loadTsConfigAliases, mergeAliases } from './aliasResolver';
import { CircularDep, RuleCheckResult, ScanOptions } from './types';
import { toMermaid, toDot } from './graphFormatter';
import { appendScoreHistory, loadScoreHistory, renderSparkline } from './scoreHistory';

// Tool version — kept in sync with package.json at build time via the version() call below.
const TOOL_VERSION: string = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (require('../package.json') as { version: string }).version;
  } catch {
    return '0.0.0';
  }
})();

const program = new Command();

program
  .name('architecture-linter')
  .description('Enforce architecture rules in TypeScript projects')
  .version(TOOL_VERSION);

// ── scan ──────────────────────────────────────────────────────────────────────

program
  .command('scan')
  .description('Scan the project for architecture violations')
  .option('-c, --context <path>', 'path to the .context.yml config file (auto-detected if omitted)')
  .option('-p, --project <path>', 'root directory of the project to scan', '.')
  .option('-f, --format <format>', 'output format: text, json, sarif, mermaid, or dot', 'text')
  .option('-s, --strict', 'report files that do not belong to any declared layer', false)
  .option('-q, --quiet', 'suppress informational output; only print violations', false)
  .option('-e, --explain', 'print why/impact/fix explanation for each violation', false)
  .option('-x, --fix', 'show a suggested fix for each violation', false)
  .option('-w, --watch', 'watch for file changes and re-run the scan automatically', false)
  .option('--baseline [path]', 'enable ratchet mode: fail only when violations increase beyond the saved baseline')
  .option('--update-baseline', 'write current violation count to the baseline file and exit 0', false)
  .option('--detect-circular', 'detect circular dependencies between layers', false)
  .option('--monorepo', 'scan all workspace packages defined in package.json workspaces', false)
  .option('--max-violations <n>', 'fail when the number of error-severity violations exceeds this threshold', parseInt)
  .action(async (options: {
    context?: string;
    project: string;
    format: string;
    strict: boolean;
    quiet: boolean;
    explain: boolean;
    fix: boolean;
    watch: boolean;
    baseline?: string | boolean;
    updateBaseline: boolean;
    detectCircular: boolean;
    monorepo: boolean;
    maxViolations?: number;
  }) => {
    const projectDir = path.resolve(options.project);
    const rawFormat = options.format.toLowerCase();
    const format = (
      rawFormat === 'json' ? 'json'
      : rawFormat === 'sarif' ? 'sarif'
      : rawFormat === 'mermaid' ? 'mermaid'
      : rawFormat === 'dot' ? 'dot'
      : 'text'
    ) as ScanOptions['format'];
    // --baseline alone (no value) defaults to true; coerce to undefined so resolveBaselinePath uses default filename
    const baselineArg = options.baseline === true ? undefined : options.baseline as string | undefined;
    const opts: ScanOptions = {
      format,
      strict: options.strict,
      quiet: options.quiet,
      explain: options.explain,
      fix: options.fix,
      watch: options.watch,
      useBaseline: options.baseline !== undefined,
      baseline: baselineArg,
      updateBaseline: options.updateBaseline,
      detectCircular: options.detectCircular,
      maxViolations: options.maxViolations,
    };

    // Resolve config: explicit flag → auto-detect walking up from project dir → error
    let contextPath: string;
    if (options.context) {
      contextPath = path.resolve(options.context);
    } else {
      const found = findContextFile(projectDir);
      if (!found) {
        console.error(
          chalk.red(
            'Error: No .context.yml found.\n' +
              'Run "architecture-linter init" to generate one, or pass --context <path>.'
          )
        );
        process.exit(1);
      }
      contextPath = found;
    }

    // Load config once (presets resolved inside loadContextConfig)
    let config;
    try {
      config = loadContextConfig(contextPath);
    } catch (err) {
      console.error(chalk.red(`Error loading config: ${(err as Error).message}`));
      process.exit(1);
    }

    // Build alias map: tsconfig.json paths + manual aliases from .context.yml
    const tsconfigAliases = loadTsConfigAliases(projectDir);
    const aliases = mergeAliases(tsconfigAliases, config.aliases, projectDir);

    /**
     * Execute one full scan pass for a single package.
     * `pkgLabel` is shown as a prefix in monorepo mode.
     * Returns true if the result should cause CI to exit 1.
     */
    const runPackageScan = async (
      scanDir: string,
      pkgConfig: ReturnType<typeof loadContextConfig>,
      pkgAliases: ReturnType<typeof mergeAliases>,
      pkgLabel?: string,
    ): Promise<boolean> => {
      let scans;
      try {
        scans = await scanProject(scanDir, pkgConfig.exclude ?? [], pkgAliases);
      } catch (err) {
        console.error(chalk.red(`Error scanning project: ${(err as Error).message}`));
        return false;
      }

      if (scans.length === 0) {
        if (format === 'json') {
          console.log(
            JSON.stringify({ filesScanned: 0, violations: [], warnings: [], unclassifiedFiles: [], violationsByLayer: {}, circularDeps: [], couplingMatrix: {} }, null, 2)
          );
        } else if (format === 'text') {
          console.log(pkgLabel
            ? `[${pkgLabel}] No TypeScript files found.`
            : 'No TypeScript files found in the specified directory.');
        }
        return false;
      }

      if (!opts.quiet && format === 'text') {
        console.log(chalk.bold(pkgLabel ? `Scanning ${pkgLabel}...\n` : 'Scanning project...\n'));
      }

      const result = checkRules(scans, pkgConfig, opts.strict, opts.fix);

      // Circular detection (mutates circularDeps on the result object)
      if (opts.detectCircular) {
        result.circularDeps = detectCircularDependencies(scans, pkgConfig.architecture.layers);
      }

      // Output
      if (format === 'sarif') {
        console.log(JSON.stringify(toSarif(result.violations, TOOL_VERSION), null, 2));
      } else if (format === 'json') {
        printJson(result, scans.length, opts, scans, pkgConfig);
      } else if (format === 'mermaid') {
        console.log(toMermaid(result.couplingMatrix));
        return false; // graph output only — never fail CI
      } else if (format === 'dot') {
        console.log(toDot(result.couplingMatrix));
        return false; // graph output only — never fail CI
      } else {
        printText(result, scans.length, opts);
        if (opts.detectCircular && result.circularDeps.length > 0) {
          printCircularDeps(result.circularDeps);
        }
      }

      const violationCount = result.violations.length;
      const hasUnclassified = opts.strict && result.unclassifiedFiles.length > 0;
      const hasCircular = opts.detectCircular && result.circularDeps.length > 0;

      // --max-violations threshold check
      if (opts.maxViolations !== undefined) {
        if (violationCount > opts.maxViolations) {
          if (!opts.quiet) {
            console.log(chalk.red(
              `Max violations exceeded: ${violationCount} (threshold: ${opts.maxViolations})`
            ));
          }
          return true;
        }
        // Under or at threshold — exit 0 regardless of violation count
        return false;
      }

      // ── Baseline / ratchet mode ────────────────────────────────────────────
      if (opts.useBaseline || opts.updateBaseline) {
        const bPath = resolveBaselinePath(opts.baseline, scanDir);
        const existing = loadBaseline(bPath);

        if (opts.updateBaseline || !existing) {
          saveBaseline(bPath, violationCount, TOOL_VERSION);
          if (!opts.quiet && format === 'text') {
            const label = pkgLabel ? `[${pkgLabel}] ` : '';
            console.log(chalk.dim(`${label}Baseline saved: ${violationCount} violation(s) → ${bPath}`));
          }
          return false;
        }

        if (hasRatchetFailed(violationCount, existing)) {
          if (!opts.quiet && format === 'text') {
            console.log(chalk.red(
              `Ratchet failed: ${violationCount} violations (was ${existing.violationCount} in baseline)`
            ));
          }
          return true;
        }

        if (!opts.quiet && format === 'text') {
          const delta = existing.violationCount - violationCount;
          const note = delta > 0 ? `↓${delta} fewer than baseline` : 'same as baseline';
          console.log(chalk.green(`Ratchet passed: ${violationCount} violations (${note})`));
        }
        return false;
      }

      return violationCount > 0 || hasUnclassified || hasCircular;
    };

    // ── Monorepo mode ─────────────────────────────────────────────────────────
    if (options.monorepo) {
      const packages = discoverWorkspacePackages(projectDir);
      if (packages.length === 0) {
        console.error(chalk.yellow(
          'No workspace packages found. Make sure your root package.json has a "workspaces" field.'
        ));
        process.exit(1);
      }

      let anyIssues = false;
      for (const pkg of packages) {
        const pkgContextFile = findContextFile(pkg.dir) ?? contextPath;
        let pkgConfig;
        try {
          pkgConfig = loadContextConfig(pkgContextFile);
        } catch (err) {
          console.error(chalk.red(`[${pkg.name}] Error loading config: ${(err as Error).message}`));
          anyIssues = true;
          continue;
        }
        const pkgTscAliases = loadTsConfigAliases(pkg.dir);
        const pkgAliases = mergeAliases(pkgTscAliases, pkgConfig.aliases, pkg.dir);
        const pkgIssues = await runPackageScan(pkg.dir, pkgConfig, pkgAliases, pkg.name);
        if (pkgIssues) anyIssues = true;
      }
      process.exit(anyIssues ? 1 : 0);
      return;
    }

    // ── Single-package scan ───────────────────────────────────────────────────
    if (opts.watch) {
      const chokidar = await import('chokidar');
      console.log(chalk.dim('Watching for file changes… (press Ctrl+C to stop)\n'));
      let running = false;

      const onChange = async (changedPath?: string) => {
        if (running) return;
        running = true;
        if (format === 'text') {
          process.stdout.write('\x1Bc');
          if (changedPath) {
            console.log(chalk.dim(`Change detected: ${path.relative(projectDir, changedPath)}\n`));
          }
        }
        await runPackageScan(projectDir, config, aliases);
        running = false;
      };

      const watcher = chokidar.watch('**/*.ts', {
        cwd: projectDir,
        ignored: /(node_modules|dist|\.d\.ts$)/,
        ignoreInitial: false,
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      });

      watcher.on('ready', () => onChange());
      watcher.on('change', (p) => onChange(path.join(projectDir, p)));
      watcher.on('add', (p) => onChange(path.join(projectDir, p)));
      watcher.on('unlink', () => onChange());
      process.stdin.resume();
    } else {
      const hasIssues = await runPackageScan(projectDir, config, aliases);
      process.exit(hasIssues ? 1 : 0);
    }
  });

// ── init ──────────────────────────────────────────────────────────────────────

/**
 * Layer names (singular) that the init command recognises from directory names.
 * Both singular and plural forms are checked (e.g. "controller" matches "controllers/").
 */
const KNOWN_LAYERS = [
  'controller', 'service', 'repository', 'middleware', 'model',
  'handler', 'resolver', 'provider', 'store', 'gateway', 'adapter',
  'route', 'util', 'helper', 'schema', 'dto', 'guard', 'filter',
  'interceptor', 'pipe', 'decorator', 'worker', 'event',
];

/** Detect which framework/preset fits the project based on package.json deps. */
function detectFramework(projectDir: string): 'nestjs' | 'nextjs' | null {
  const pkgPath = path.join(projectDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    if ('@nestjs/core' in allDeps || '@nestjs/common' in allDeps) return 'nestjs';
    if ('next' in allDeps) return 'nextjs';
  } catch { /* ignore */ }
  return null;
}

/**
 * Detect NestJS layers by scanning for typed file suffixes (*.controller.ts etc.)
 * inside src/ and module subdirectories.
 */
function detectNestJsLayersFromFiles(projectDir: string): string[] {
  const suffixToLayer: Record<string, string> = {
    'controller': 'controller',
    'service': 'service',
    'schema': 'schema',
    'module': 'module',
    'guard': 'guard',
    'filter': 'filter',
    'interceptor': 'interceptor',
    'pipe': 'pipe',
    'decorator': 'decorator',
  };
  const found = new Set<string>();
  const dirsToSearch = [projectDir, path.join(projectDir, 'src')];

  for (const base of dirsToSearch) {
    if (!fs.existsSync(base)) continue;
    try {
      const walk = (dir: string, depth: number) => {
        if (depth > 4) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') {
            walk(path.join(dir, entry.name), depth + 1);
            if (entry.name === 'dto') found.add('dto');
          } else if (entry.isFile() && entry.name.endsWith('.ts')) {
            for (const [suffix, layer] of Object.entries(suffixToLayer)) {
              if (entry.name.endsWith(`.${suffix}.ts`)) found.add(layer);
            }
          }
        }
      };
      walk(base, 0);
    } catch { /* ignore */ }
  }
  return [...found];
}

program
  .command('init')
  .description('Generate a starter .context.yml by inspecting the project directory structure')
  .option('-p, --project <path>', 'root directory of the project', '.')
  .option('--force', 'overwrite an existing .context.yml', false)
  .action((options: { project: string; force: boolean }) => {
    const projectDir = path.resolve(options.project);
    const outputPath = path.join(projectDir, '.context.yml');

    if (fs.existsSync(outputPath) && !options.force) {
      console.error(chalk.yellow(
        `A .context.yml already exists at ${outputPath}\n` +
        `Run with ${chalk.bold('--force')} to overwrite it.`
      ));
      process.exit(1);
    }

    // ── Framework detection ────────────────────────────────────────────────
    const framework = detectFramework(projectDir);

    // ── Directory-name layer detection ────────────────────────────────────
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(projectDir, { withFileTypes: true });
    } catch {
      console.error(chalk.red(`Cannot read directory: ${projectDir}`));
      process.exit(1);
    }

    const srcDir = path.join(projectDir, 'src');
    if (fs.existsSync(srcDir)) {
      try {
        entries.push(...fs.readdirSync(srcDir, { withFileTypes: true }));
      } catch { /* ignore */ }
    }

    const skipDirs = new Set(['node_modules', 'dist', 'build', 'coverage', 'src', '.git']);
    const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && !skipDirs.has(e.name));

    const candidates = (layer: string): string[] => {
      const lower = layer.toLowerCase();
      return lower.endsWith('y') ? [lower, lower.slice(0, -1) + 'ies'] : [lower, lower + 's'];
    };

    const detectedFromDirs: string[] = [];
    for (const d of dirs) {
      const lower = d.name.toLowerCase();
      for (const layer of KNOWN_LAYERS) {
        if (candidates(layer).includes(lower) && !detectedFromDirs.includes(layer)) {
          detectedFromDirs.push(layer);
          break;
        }
      }
    }

    // ── File-suffix detection (NestJS *.controller.ts pattern) ────────────
    const detectedFromFiles = framework === 'nestjs'
      ? detectNestJsLayersFromFiles(projectDir)
      : [];

    // Merge: file-suffix detection fills gaps not found by directory names
    const detectedLayers = [...detectedFromDirs];
    for (const l of detectedFromFiles) {
      if (!detectedLayers.includes(l)) detectedLayers.push(l);
    }

    if (detectedLayers.length === 0) {
      console.log(chalk.yellow('No recognisable layers found. A minimal template will be generated.'));
      detectedLayers.push('controller', 'service', 'repository');
    }

    // ── Build YAML content ─────────────────────────────────────────────────
    let content: string;
    const NESTJS_PRESET_LAYERS = [
      'module','controller','service','schema','dto','utils',
      'guard','decorator','filter','interceptor','pipe',
    ];

    if (framework === 'nestjs') {
      const extraLayers = detectedLayers.filter(l => !NESTJS_PRESET_LAYERS.includes(l));
      const extraLayersYaml = extraLayers.length > 0
        ? '\n  # Extra layers detected in this project:\n' + extraLayers.map(l => `    - ${l}`).join('\n')
        : '';

      content = [
        '# .context.yml \u2014 generated by architecture-linter init',
        '# Framework detected: NestJS',
        '#',
        '# This config extends the built-in "nestjs" preset, which enforces:',
        '#   - controller cannot import schema or another controller',
        '#   - service cannot import controller',
        '#   - utils cannot import service or controller',
        '#   - guard/interceptor/pipe cannot import schema',
        '#',
        '# Add project-specific overrides in the rules section below.',
        '',
        'extends: nestjs',
        '',
        'architecture:',
        '  layers: []  # preset provides the base layers; add extras here if needed' + extraLayersYaml,
        '',
        'rules: {}  # preset rules are active; override or add per-layer rules here',
        '#',
        '# Example — prevent workers from importing controllers or schemas:',
        '#   worker:',
        '#     cannot_import:',
        '#       - controller',
        '#       - schema',
        '',
        '# Exclude patterns (project-relative globs):',
        '# exclude:',
        '#   - "**/*.spec.ts"',
        '#   - "**/__mocks__/**"',
        '',
      ].join('\n');

    } else if (framework === 'nextjs') {
      content = [
        '# .context.yml \u2014 generated by architecture-linter init',
        '# Framework detected: Next.js',
        '#',
        '# This config extends the built-in "nextjs" preset, which enforces:',
        '#   - page and component cannot import api routes directly',
        '#',
        '',
        'extends: nextjs',
        '',
        'architecture:',
        '  layers: []  # preset provides the base layers',
        '',
        'rules: {}  # add project-specific overrides here',
        '',
        '# Exclude patterns (project-relative globs):',
        '# exclude:',
        '#   - "**/*.test.ts"',
        '',
      ].join('\n');

    } else {
      const layersYaml = detectedLayers.map(l => `    - ${l}`).join('\n');
      const rulesYaml = detectedLayers
        .map(l => `  ${l}:\n    cannot_import: []`)
        .join('\n\n');

      content = [
        '# .context.yml \u2014 generated by architecture-linter init',
        '#',
        '# Define which layers exist and what each layer is forbidden from importing.',
        '# Example: prevent controllers from importing repositories directly:',
        '#',
        '#   controller:',
        '#     cannot_import:',
        '#       - repository',
        '#',
        '# To whitelist instead of blacklist, use can_only_import:',
        '#',
        '#   repository:',
        '#     can_only_import: []  # repository imports nothing from other layers',
        '#',
        '# To scope a rule to specific files, add a files glob:',
        '#',
        '#   controller:',
        '#     files: "src/controllers/**"',
        '#     cannot_import:',
        '#       - repository',
        '',
        'architecture:',
        '  layers:',
        layersYaml,
        '',
        'rules:',
        rulesYaml,
        '',
        '# Exclude patterns (project-relative globs):',
        '# exclude:',
        '#   - "**/*.spec.ts"',
        '#   - "**/__mocks__/**"',
        '',
      ].join('\n');
    }

    fs.writeFileSync(outputPath, content, 'utf-8');

    console.log(chalk.green(`\u2705 Created .context.yml at: ${outputPath}`));
    if (framework) {
      console.log(`   Framework:       ${chalk.cyan(framework)} ${chalk.dim('(preset applied)')}`);
    }
    if (detectedFromFiles.length > 0) {
      console.log(`   Layers (files):  ${chalk.cyan(detectedFromFiles.join(', '))}`);
    } else if (!framework) {
      console.log(`   Detected layers: ${chalk.cyan(detectedLayers.join(', '))}`);
    }
    console.log(`\n${chalk.dim('Run a scan to see your architecture health:')}`);
    console.log(`   ${chalk.bold('architecture-linter scan')}\n`);
  });

// ── ci ────────────────────────────────────────────────────────────────────────

const CI_PLATFORMS = ['github'] as const;
type CiPlatform = typeof CI_PLATFORMS[number];

program
  .command('ci')
  .description('Generate a CI workflow file that runs architecture-linter on every push/PR')
  .option('--platform <platform>', 'CI platform to target: github', 'github')
  .option('-p, --project <path>', 'root directory of the project', '.')
  .action((options: { platform: string; project: string }) => {
    const projectDir = path.resolve(options.project);
    const platform = options.platform.toLowerCase() as CiPlatform;

    if (!CI_PLATFORMS.includes(platform)) {
      console.error(chalk.red(`Unknown platform: "${platform}". Supported platforms: ${CI_PLATFORMS.join(', ')}`));
      process.exit(1);
    }

    if (platform === 'github') {
      const workflowDir = path.join(projectDir, '.github', 'workflows');
      const workflowPath = path.join(workflowDir, 'arch-lint.yml');

      if (fs.existsSync(workflowPath)) {
        console.error(chalk.yellow(`A workflow already exists at ${workflowPath}`));
        process.exit(1);
      }

      fs.mkdirSync(workflowDir, { recursive: true });

      const workflowContent = [
        '# arch-lint.yml - generated by architecture-linter ci',
        '# Runs architecture-linter on every push and pull request.',
        '# See: https://github.com/cvalingam/architecture-linter',
        '',
        'name: Architecture Lint',
        '',
        'on:',
        '  push:',
        '    branches: ["**"]',
        '  pull_request:',
        '    branches: ["**"]',
        '',
        'jobs:',
        '  arch-lint:',
        '    runs-on: ubuntu-latest',
        '',
        '    steps:',
        '      - name: Checkout repository',
        '        uses: actions/checkout@v4',
        '',
        '      - name: Set up Node.js',
        '        uses: actions/setup-node@v4',
        '        with:',
        '          node-version: "20"',
        '          cache: "npm"',
        '',
        '      - name: Install dependencies',
        '        run: npm ci',
        '',
        '      - name: Build',
        '        run: npm run build',
        '',
        '      - name: Run architecture linter',
        '        run: npx architecture-linter scan --strict',
        '',
      ].join('\n');

      fs.writeFileSync(workflowPath, workflowContent, 'utf-8');
      console.log(chalk.green(`\u2705 Created GitHub Actions workflow at: ${workflowPath}`));
      console.log(`\n${chalk.dim('Commit and push this file to enable CI enforcement:')}`);
      console.log(`   ${chalk.bold('git add .github/workflows/arch-lint.yml')}`);
      console.log(`   ${chalk.bold('git commit -m "ci: add architecture-linter workflow"')}`);
      console.log(`   ${chalk.bold('git push')}\n`);
    }
  });

// ── score ──────────────────────────────────────────────────────────────────────

program
  .command('score')
  .description('Calculate an architecture health score (0–100) for the project')
  .option('-c, --context <path>', 'path to the .context.yml config file (auto-detected if omitted)')
  .option('-p, --project <path>', 'root directory of the project to scan', '.')
  .option('-f, --format <format>', 'output format: text or json', 'text')
  .action(async (options: { context?: string; project: string; format: string }) => {
    const projectDir = path.resolve(options.project);
    const format = options.format === 'json' ? 'json' : 'text';

    let contextPath: string;
    if (options.context) {
      contextPath = path.resolve(options.context);
    } else {
      const found = findContextFile(projectDir);
      if (!found) {
        console.error(chalk.red('Error: No .context.yml found. Run "architecture-linter init" to generate one.'));
        process.exit(1);
      }
      contextPath = found;
    }

    let config;
    try {
      config = loadContextConfig(contextPath);
    } catch (err) {
      console.error(chalk.red(`Error loading config: ${(err as Error).message}`));
      process.exit(1);
    }

    const tsconfigAliases = loadTsConfigAliases(projectDir);
    const aliases = mergeAliases(tsconfigAliases, config.aliases, projectDir);

    let scans;
    try {
      scans = await scanProject(projectDir, config.exclude ?? [], aliases);
    } catch (err) {
      console.error(chalk.red(`Error scanning project: ${(err as Error).message}`));
      process.exit(1);
    }

    const result = checkRules(scans, config, true, false);
    const archScore = calculateScore(scans, result, config);

    // Persist score to history file
    appendScoreHistory(projectDir, {
      timestamp: new Date().toISOString(),
      score: archScore.score,
      grade: archScore.grade,
      violations: result.violations.length,
      version: TOOL_VERSION,
    });

    if (format === 'json') {
      const history = loadScoreHistory(projectDir);
      console.log(JSON.stringify({ ...archScore, history }, null, 2));
    } else {
      printScoreText(archScore, projectDir);
    }

    process.exit(0);
  });

// ── badge ─────────────────────────────────────────────────────────────────────

const BADGE_COLOURS: Record<string, string> = {
  A: 'brightgreen',
  B: 'green',
  C: 'yellow',
  D: 'orange',
  F: 'red',
};

program
  .command('badge')
  .description('Generate a shields.io badge URL for the architecture health score')
  .option('-c, --context <path>', 'path to the .context.yml config file (auto-detected if omitted)')
  .option('-p, --project <path>', 'root directory of the project to scan', '.')
  .option('-f, --format <format>', 'output format: url or markdown', 'url')
  .option('-o, --output <path>', 'write output to a file instead of stdout')
  .action(async (options: { context?: string; project: string; format: string; output?: string }) => {
    const projectDir = path.resolve(options.project);

    let contextPath: string;
    if (options.context) {
      contextPath = path.resolve(options.context);
    } else {
      const found = findContextFile(projectDir);
      if (!found) {
        console.error(chalk.red('Error: No .context.yml found. Run "architecture-linter init" to generate one.'));
        process.exit(1);
      }
      contextPath = found;
    }

    let config;
    try {
      config = loadContextConfig(contextPath);
    } catch (err) {
      console.error(chalk.red(`Error loading config: ${(err as Error).message}`));
      process.exit(1);
    }

    const tsconfigAliases = loadTsConfigAliases(projectDir);
    const aliases = mergeAliases(tsconfigAliases, config.aliases, projectDir);

    let scans;
    try {
      scans = await scanProject(projectDir, config.exclude ?? [], aliases);
    } catch (err) {
      console.error(chalk.red(`Error scanning project: ${(err as Error).message}`));
      process.exit(1);
    }

    const result = checkRules(scans, config, true, false);
    const archScore = calculateScore(scans, result, config);

    const colour = BADGE_COLOURS[archScore.grade] ?? 'lightgrey';
    const label = encodeURIComponent('arch score');
    const message = encodeURIComponent(`${archScore.grade} (${archScore.score}/100)`);
    const url = `https://img.shields.io/badge/${label}-${message}-${colour}`;

    const fmt = options.format.toLowerCase();
    let output: string;
    if (fmt === 'markdown') {
      output = `![Architecture Score](${url})`;
    } else {
      output = url;
    }

    if (options.output) {
      fs.writeFileSync(path.resolve(options.output), output + '\n', 'utf-8');
      console.log(chalk.green(`Badge written to: ${options.output}`));
    } else {
      console.log(output);
    }

    process.exit(0);
  });

program.parse(process.argv);

// ── output helpers ────────────────────────────────────────────────────────────

function printJson(result: RuleCheckResult, filesScanned: number, opts: ScanOptions, scans?: import('./types').FileScan[], config?: import('./types').ContextConfig): void {
  const mapViolation = (v: import('./types').Violation) => {
    const entry: Record<string, unknown> = { ...v };
    if (opts.explain) {
      entry.explanation = explain(v.sourceLayer, v.targetLayer, v.rule);
    }
    return entry;
  };

  console.log(
    JSON.stringify(
      {
        filesScanned,
        violations: result.violations.map(mapViolation),
        warnings: result.warnings.map(mapViolation),
        unclassifiedFiles: result.unclassifiedFiles,
        violationsByLayer: result.violationsByLayer,
        circularDeps: result.circularDeps,
        couplingMatrix: result.couplingMatrix,
        ...(scans && config ? { score: calculateScore(scans, result, config) } : {}),
      },
      null,
      2
    )
  );
}

function printText(result: RuleCheckResult, filesScanned: number, opts: ScanOptions): void {
  const { violations, warnings, unclassifiedFiles, violationsByLayer } = result;

  // Warn-severity violations
  for (const v of warnings) {
    console.log(chalk.yellow.bold('⚠️  Architecture warning\n'));
    console.log(`   ${chalk.bold('File:')}   ${chalk.yellow(v.file)}`);
    console.log(`   ${chalk.bold('Import:')} ${v.importPath}`);
    console.log(`   ${chalk.bold('Rule:')}   ${v.rule}`);
    console.log();
  }

  // Error-severity violations
  for (const v of violations) {
    console.log(chalk.red.bold('❌ Architecture violation detected\n'));
    console.log(`   ${chalk.bold('File:')}   ${chalk.yellow(v.file)}`);
    console.log(`   ${chalk.bold('Import:')} ${v.importPath}`);
    console.log(`   ${chalk.bold('Rule:')}   ${v.rule}`);

    if (opts.explain) {
      const exp = explain(v.sourceLayer, v.targetLayer, v.rule);
      console.log();
      console.log(`   ${chalk.cyan.bold('💡 Why this matters')}`);
      console.log(wordWrap(exp.why, 72, '      '));
      console.log();
      console.log(`   ${chalk.yellow.bold('⚡ Impact')}`);
      console.log(wordWrap(exp.impact, 72, '      '));
      console.log();
      console.log(`   ${chalk.green.bold('✅ How to fix')}`);
      console.log(wordWrap(exp.fix, 72, '      '));
    }

    if (opts.fix && v.fix) {
      console.log();
      console.log(`   ${chalk.blue.bold('🔧 Suggested fix')}`);
      console.log(wordWrap(v.fix, 72, '      '));
    }

    console.log();
  }

  // Strict mode: unclassified files
  if (opts.strict && unclassifiedFiles.length > 0) {
    console.log(chalk.yellow.bold('⚠️  Unclassified files (not assigned to any layer):\n'));
    for (const f of unclassifiedFiles) {
      console.log(`   ${f}`);
    }
    console.log();
  }

  if (violations.length === 0 && warnings.length === 0 && (!opts.strict || unclassifiedFiles.length === 0)) {
    console.log(chalk.green(`✅ No architecture violations found. (${filesScanned} file(s) scanned)`));
    return;
  }

  if (warnings.length > 0 && violations.length === 0 && (!opts.strict || unclassifiedFiles.length === 0)) {
    const wLabel = warnings.length === 1 ? 'warning' : 'warnings';
    console.log(chalk.yellow(`⚠️  ${warnings.length} ${wLabel} found in ${filesScanned} file(s) scanned. (exit 0)`));
    return;
  }

  // Per-layer violation summary
  console.log(chalk.bold('── Violations by layer ──────────────────'));
  for (const [layer, count] of Object.entries(violationsByLayer)) {
    const label = `   ${layer.padEnd(16)} ${count} violation(s)`;
    console.log(count > 0 ? chalk.red(label) : chalk.green(label));
  }
  console.log();

  const vLabel = violations.length === 1 ? 'violation' : 'violations';
  console.log(chalk.red.bold(`Found ${violations.length} ${vLabel} in ${filesScanned} file(s) scanned.`));

  if (opts.strict && unclassifiedFiles.length > 0) {
    console.log(chalk.yellow(`Found ${unclassifiedFiles.length} unclassified file(s).`));
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function printScoreText(s: import('./types').ArchScore, projectDir?: string): void {
  const gradeColour = s.grade === 'A' ? chalk.green
    : s.grade === 'B' ? chalk.cyan
    : s.grade === 'C' ? chalk.yellow
    : chalk.red;

  const bar = '█'.repeat(Math.round(s.score / 5)) + '░'.repeat(20 - Math.round(s.score / 5));

  console.log();
  console.log(chalk.bold('Architecture Health Score'));
  console.log();
  console.log(`  ${gradeColour.bold(`${s.score}/100`)}  Grade: ${gradeColour.bold(s.grade)}  ${gradeColour(bar)}`);

  // Show score sparkline when history is available
  if (projectDir) {
    const history = loadScoreHistory(projectDir);
    const sparkline = renderSparkline(history);
    if (sparkline) {
      console.log(`  Trend: ${chalk.cyan(sparkline)}`);
    }
  }

  console.log();
  console.log(chalk.bold('  Breakdown:'));
  console.log(`    Violation density   ${String(s.breakdown.violations).padStart(3)}/60  pts`);
  console.log(`    Layer coverage      ${String(s.breakdown.coverage).padStart(3)}/25  pts`);
  console.log(`    Rule completeness   ${String(s.breakdown.ruleCompleteness).padStart(3)}/15  pts`);
  console.log();
  console.log(chalk.bold('  Stats:'));
  console.log(`    Files scanned:      ${s.stats.filesScanned}`);
  console.log(`    Total imports:      ${s.stats.totalImports}`);
  console.log(`    Violations:         ${s.stats.violationCount}`);
  console.log(`    Classified files:   ${s.stats.classifiedFiles}/${s.stats.filesScanned}`);
  console.log(`    Layers with rules:  ${s.stats.layersWithRules}/${s.stats.totalLayers}`);
  console.log();
}

/**
 * Wraps `text` at `maxWidth` characters, prefixing every line with `indent`.
 */
function wordWrap(text: string, maxWidth: number, indent: string): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = indent;

  for (const word of words) {
    if (current.length + word.length + 1 > maxWidth && current.trim().length > 0) {
      lines.push(current);
      current = indent + word;
    } else {
      current = current.trim().length === 0 ? indent + word : current + ' ' + word;
    }
  }
  if (current.trim().length > 0) lines.push(current);
  return lines.join('\n');
}

function printCircularDeps(cycles: CircularDep[]): void {
  console.log();
  console.log(chalk.magenta.bold('⟳  Circular dependencies detected between layers:\n'));
  for (const { cycle } of cycles) {
    console.log(`   ${chalk.magenta(cycle.join(' → '))}`);
  }
  console.log();
}
