# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-03-16

First stable release. API, CLI flags, and `.context.yml` schema are now stable.

### Added
- GitHub Sponsors support
- Smart `init` command — auto-detects NestJS and Next.js from `package.json`
- NestJS file-suffix scanning (`.controller.ts`, `.service.ts`, etc.)
- `--force` flag on `init` to overwrite existing config
- Updated NestJS preset to real-world modular architecture (module, controller, service, schema, dto, guard, decorator, filter, interceptor, pipe)
- `context.schema.json` `extends` field supports both string and array forms

### Fixed
- Dependabot vulnerability alerts: semver@6 (HIGH ReDoS) and glob@7/inflight (MODERATE) resolved via npm overrides

### Changed
- VS Code extension published to Marketplace (`cvalingam.architecture-linter-vscode`)

---

## [0.1.8] - 2026-03-14

### Added
- Updated NestJS preset layers and rules
- Fixed `context.schema.json` extends enum to list real preset names

---

## [0.1.7] - 2026-03-10

### Added
- `--max-violations` flag — fail CI only when violation count exceeds threshold
- Wildcard layer support in rules
- Architecture score history tracking
- Graph output format (`--format graph`)
- Coupling matrix in JSON output

---

## [0.1.6] - 2026-03-07

### Added
- JS/JSX file support alongside TypeScript
- Severity levels on rules (`error` / `warn`)
- SARIF output format (`--format sarif`) for GitHub Code Scanning

---

## [0.1.5] - 2026-03-04

### Added
- `badge` command — generates shields.io badge URL for architecture health score
- `score` command — architecture health score 0–100 with grade (A–F)
- `scan --baseline` ratchet mode — fails only when violations increase
- `scan --detect-circular` — detects circular dependencies between layers

---

## [0.1.4] - 2026-03-01

### Added
- `scan --monorepo` — scans all workspace packages
- `scan --explain` — why/impact/how-to-fix guidance per violation
- `scan --fix` — suggested fix per violation
- `scan --watch` — re-scan on file changes

---

## [0.1.3] - 2026-02-26

### Added
- `ci` command — generates GitHub Actions workflow file
- GitHub Action (`cvalingam/architecture-linter`) with PR annotation support
- `scan --format json` output

---

## [0.1.2] - 2026-02-22

### Added
- Built-in presets: `nestjs`, `clean-architecture`, `hexagonal`, `nextjs`
- `extends` key in `.context.yml` — extend a preset or merge multiple
- Inline suppression with `// arch-ignore:` comments
- Path alias resolution from `tsconfig.json`

---

## [0.1.1] - 2026-02-18

### Added
- `init` command — generates starter `.context.yml` from directory structure
- `can_only_import` whitelist rule option
- Rule scoping with `files` glob pattern

---

## [0.1.0] - 2026-02-15

Initial release.

### Added
- `scan` command — detects import violations against `.context.yml` rules
- Layer detection from directory names (singular and plural forms)
- `cannot_import` blacklist rule option
- Exit code `1` on violations for CI integration
