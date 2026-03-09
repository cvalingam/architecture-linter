# architecture-linter

> Enforce architectural layer rules in TypeScript projects from the command line.

`architecture-linter` reads a `.context.yml` configuration file and scans your
TypeScript source tree for dependency violations — such as a controller importing
a repository directly, bypassing the service layer.

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Build
npm run build

# 3. Scan the bundled example project
node dist/cli.js scan \
  --context examples/sample.context.yml \
  --project examples/sample-project
```

Expected output:

```
Scanning project...

❌ Architecture violation detected

   File:   controllers/orderController.ts
   Import: repositories/orderRepository
   Rule:   Controller cannot import Repository

── Violations by layer ──────────────────
   controller       1 violation(s)
   service          0 violation(s)
   repository       0 violation(s)

Found 1 violation in 3 file(s) scanned.
```

---

## Installation

### As a local dev dependency

```bash
npm install --save-dev architecture-linter
```

Then add a script to your `package.json`:

```json
{
  "scripts": {
    "lint:arch": "architecture-linter scan"
  }
}
```

### Global install

```bash
npm install -g architecture-linter
```

---

## Quick setup for a new project

Run `init` to auto-generate a `.context.yml` by inspecting your project's folder
structure. The command detects common layer names (`controller`, `service`,
`repository`, `middleware`, etc.) from top-level and `src/` subdirectory names.

```bash
architecture-linter init
```

Then edit the generated file to add your constraints, and run:

```bash
architecture-linter scan
```

---

## Configuration

Create a `.context.yml` file in your project root (or pass `--context` to
override). When `--context` is omitted, the linter walks up the directory tree
from `--project` until a `.context.yml` is found — just like ESLint.

```yaml
architecture:
  layers:
    - controller
    - service
    - repository

rules:
  # Blacklist: this layer must NOT import from any layer in the list.
  controller:
    cannot_import:
      - repository

  # Whitelist: this layer may ONLY import from layers in the list.
  # Any import from a layer NOT in the list is a violation.
  service:
    can_only_import:
      - repository

  repository:
    cannot_import: []

# Glob patterns (project-relative) for files to skip entirely.
exclude:
  - "**/*.spec.ts"
  - "**/*.test.ts"
  - "**/__mocks__/**"
```

### Rule options

| Option | Type | Description |
|---|---|---|
| `cannot_import` | `string[]` | Blacklist — the layer must not import from any listed layer |
| `can_only_import` | `string[]` | Whitelist — the layer may only import from listed layers |
| `files` | `string` (glob) | Scope this rule to source files matching the pattern |

`cannot_import` and `can_only_import` are mutually exclusive. Use one per layer rule.

#### Scoping a rule to specific files

```yaml
rules:
  controller:
    files: "src/controllers/**"
    cannot_import:
      - repository
```

### Inline suppression with `arch-ignore`

To suppress a single violation without removing the import, add an
`// arch-ignore:` comment on the line immediately before the import statement:

```ts
// arch-ignore: controller cannot import repository
import { OrderRepository } from '../repositories/orderRepository';
```

The hint must match the rule string (case-insensitive): `<sourceLayer> cannot import <targetLayer>`.

---

### How layer detection works

The linter infers a file's layer from its **directory name**. A file inside a
directory called `controllers/` or `controller/` is automatically assigned to
the `controller` layer. Both singular and plural forms are recognised (including
irregular plurals such as `repository` → `repositories`).

| Path | Detected layer |
|---|---|
| `controllers/orderController.ts` | `controller` |
| `services/orderService.ts` | `service` |
| `repositories/orderRepository.ts` | `repository` |

---

## CLI reference

### `scan`

```
architecture-linter scan [options]

Options:
  -c, --context <path>   Path to the .context.yml file (auto-detected if omitted)
  -p, --project <path>   Root directory of the project  (default: .)
  -f, --format <format>  Output format: text or json     (default: text)
  -s, --strict           Report files not assigned to any layer
  -q, --quiet            Suppress the "Scanning project..." banner
  -V, --version          Print version number
  -h, --help             Display help
```

### `init`

```
architecture-linter init [options]

Options:
  -p, --project <path>   Root directory of the project  (default: .)
```

Generates a starter `.context.yml` by detecting layer names from directory
structure. Fails if a `.context.yml` already exists.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | No violations found |
| `1` | One or more violations found (or a fatal error occurred) |

This makes the tool suitable for CI pipelines:

```yaml
# .github/workflows/ci.yml (example)
- name: Architecture lint
  run: npx architecture-linter scan
```

### JSON output for tooling integration

```bash
architecture-linter scan --format json
```

```json
{
  "filesScanned": 3,
  "violations": [
    {
      "file": "controllers/orderController.ts",
      "importPath": "repositories/orderRepository",
      "rawSpecifier": "../repositories/orderRepository",
      "sourceLayer": "controller",
      "targetLayer": "repository",
      "rule": "Controller cannot import Repository"
    }
  ],
  "unclassifiedFiles": [],
  "violationsByLayer": {
    "controller": 1,
    "service": 0,
    "repository": 0
  }
}
```

---

## Development

```bash
# Run directly with ts-node (no build step required)
npx ts-node src/cli.ts scan --context examples/sample.context.yml --project examples/sample-project

# Build to dist/
npm run build

# Run the compiled output
node dist/cli.js scan --context examples/sample.context.yml --project examples/sample-project

# Clean build artefacts
npm run clean
```

---

## Project structure

```
architecture-linter/
├── src/
│   ├── cli.ts               # Commander-based CLI entry point
│   ├── contextParser.ts     # Loads and validates .context.yml; walks up tree
│   ├── dependencyScanner.ts # Walks .ts files and extracts imports via ts-morph
│   ├── ruleEngine.ts        # Matches imports against rules and returns violations
│   └── types.ts             # Shared TypeScript interfaces
│
├── examples/
│   ├── sample.context.yml                        # Example rule configuration
│   └── sample-project/
│       ├── controllers/orderController.ts        # ❌ contains an intentional violation
│       ├── services/orderService.ts
│       └── repositories/orderRepository.ts
│
├── package.json
├── tsconfig.json
└── README.md
```

---

## How it works

1. **Parse config** — `contextParser` loads `.context.yml` using `js-yaml`,
   validates required fields, and walks up the directory tree when no explicit
   path is provided.
2. **Scan files** — `dependencyScanner` uses `fast-glob` to find every `.ts`
   file (respecting `exclude` patterns) and `ts-morph` to parse import
   declarations. Relative imports are resolved to project-relative paths.
   Each import is checked for a preceding `// arch-ignore:` comment.
3. **Apply rules** — `ruleEngine` maps each file and resolved import to an
   architectural layer, then evaluates `cannot_import` (blacklist) and
   `can_only_import` (whitelist) rules. Per-rule `files` glob scoping is
   applied via `minimatch`.
4. **Report** — The CLI prints every violation with the file, import path, and
   rule broken. A per-layer summary is shown at the end. `--format json` emits
   machine-readable output.

---

## Roadmap (post-MVP)

- `--fix` flag to suggest corrected import paths
- SARIF output format for GitHub Advanced Security integration
- Watch mode (`--watch`)
- Support for TypeScript path alias resolution (`@app/repositories`)

---

## License

MIT


`architecture-linter` reads a `.context.yml` configuration file and scans your
TypeScript source tree for dependency violations — such as a controller importing
a repository directly, bypassing the service layer.

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Build
npm run build

# 3. Scan the bundled example project
node dist/cli.js scan \
  --context examples/sample.context.yml \
  --project examples/sample-project
```

Expected output:

```
Scanning project...

❌ Architecture violation detected

   File:    controllers/orderController.ts
   Import:  repositories/orderRepository
   Rule:    Controller cannot import Repository

Found 1 violation in 3 file(s) scanned.
```

---

## Installation

### As a local dev dependency

```bash
npm install --save-dev architecture-linter
```

Then add a script to your `package.json`:

```json
{
  "scripts": {
    "lint:arch": "architecture-linter scan"
  }
}
```

### Global install

```bash
npm install -g architecture-linter
```

---

## Configuration

Create a `.context.yml` file in your project root (or pass `--context` to point
to a different path).

```yaml
architecture:
  layers:
    - controller
    - service
    - repository

rules:
  controller:
    cannot_import:
      - repository   # Controllers must go through the service layer

  service:
    cannot_import: []

  repository:
    cannot_import: []
```

### How layer detection works

The linter infers a file's layer from its **directory name**. A file inside a
directory called `controllers/` or `controller/` is automatically assigned to
the `controller` layer. Both singular and plural forms are recognised.

| Path | Detected layer |
|---|---|
| `controllers/orderController.ts` | `controller` |
| `services/orderService.ts` | `service` |
| `repositories/orderRepository.ts` | `repository` |

The same logic applies to import paths: a relative import that resolves into a
`repositories/` directory is treated as a `repository`-layer import.

---

## CLI reference

```
architecture-linter scan [options]

Options:
  -c, --context <path>   Path to the .context.yml file  (default: .context.yml)
  -p, --project <path>   Root directory of the project  (default: .)
  -V, --version          Print version number
  -h, --help             Display help
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | No violations found |
| `1` | One or more violations found (or a fatal error occurred) |

This makes the tool suitable for use in CI pipelines:

```yaml
# .github/workflows/ci.yml (example)
- name: Architecture lint
  run: npx architecture-linter scan
```

---

## Development

```bash
# Run directly with ts-node (no build step required)
npx ts-node src/cli.ts scan --context examples/sample.context.yml --project examples/sample-project

# Build to dist/
npm run build

# Run the compiled output
node dist/cli.js scan --context examples/sample.context.yml --project examples/sample-project

# Clean build artefacts
npm run clean
```

---

## Project structure

```
architecture-linter/
├── src/
│   ├── cli.ts               # Commander-based CLI entry point
│   ├── contextParser.ts     # Loads and validates .context.yml
│   ├── dependencyScanner.ts # Walks .ts files and extracts imports via ts-morph
│   ├── ruleEngine.ts        # Matches imports against rules and returns violations
│   └── types.ts             # Shared TypeScript interfaces
│
├── examples/
│   ├── sample.context.yml                        # Example rule configuration
│   └── sample-project/
│       ├── controllers/orderController.ts        # ❌ contains an intentional violation
│       ├── services/orderService.ts
│       └── repositories/orderRepository.ts
│
├── package.json
├── tsconfig.json
└── README.md
```

---

## How it works

1. **Parse config** — `contextParser` loads `.context.yml` using `js-yaml` and
   validates the required fields.
2. **Scan files** — `dependencyScanner` uses `fast-glob` to find every `.ts`
   file in the project and `ts-morph` to parse its import declarations.
   Relative imports are resolved to project-relative paths.
3. **Apply rules** — `ruleEngine` maps each file and each resolved import path
   to an architectural layer, then checks the `cannot_import` rules.
4. **Report** — The CLI prints every violation with the offending file, the
   resolved import path, and the rule that was broken.

---

## Roadmap (post-MVP)

- `--fix` flag to suggest corrected import paths
- JSON / SARIF output format for CI integration
- Wildcard layer patterns (`src/*/controllers/**`)
- Support for path alias resolution (`@app/repositories`)
- Watch mode

---

## License

MIT
