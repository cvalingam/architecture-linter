#!/usr/bin/env node
'use strict';

const fs = require('fs');
const https = require('https');

const [, , resultsPath, failOnViolationsArg, workingDir, token, prNumber, repo] = process.argv;

const failOnViolations = failOnViolationsArg !== 'false';

// ── Load results ──────────────────────────────────────────────────────────────
let results;
try {
  results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
} catch {
  console.log('::notice::architecture-linter: no results file found — skipping annotation');
  process.exit(0);
}

const violations = results.violations || [];

if (violations.length === 0) {
  console.log('::notice::✅ No architecture violations found');
  process.exit(0);
}

// ── Emit inline annotations ───────────────────────────────────────────────────
for (const v of violations) {
  const file = v.file ? v.file.replace(/\\/g, '/') : 'unknown';
  const line = v.line || 1;
  const msg  = v.rule || 'Architecture violation';
  const fix  = v.fix  ? ` | Fix: ${v.fix}` : '';
  console.log(`::error file=${file},line=${line},title=Architecture violation::${msg}${fix}`);
}

// ── Summary to step log ───────────────────────────────────────────────────────
console.log('');
console.log(`❌ Found ${violations.length} architecture violation(s)`);
console.log('');

const byLayer = results.violationsByLayer || {};
if (Object.keys(byLayer).length > 0) {
  console.log('Violations by layer:');
  for (const [layer, count] of Object.entries(byLayer)) {
    if (count > 0) console.log(`  ${layer}: ${count}`);
  }
}

// ── Optional PR comment ───────────────────────────────────────────────────────
if (token && prNumber && prNumber !== '' && repo) {
  const rows = violations
    .map(v => {
      const file  = v.file        ? `\`${v.file}\`` : '—';
      const line  = v.line        ? `L${v.line}`    : '—';
      const rule  = v.rule        || '—';
      const fix   = v.fix         ? v.fix            : '—';
      return `| ${file} | ${line} | ${rule} | ${fix} |`;
    })
    .join('\n');

  const body = [
    '## ❌ Architecture violations detected',
    '',
    `Found **${violations.length} violation(s)** in **${results.filesScanned || '?'} file(s)** scanned.`,
    '',
    '| File | Line | Rule | Suggested fix |',
    '|------|------|------|--------------|',
    rows,
    '',
    '> Powered by [architecture-linter](https://github.com/cvalingam/architecture-linter)',
  ].join('\n');

  const payload = JSON.stringify({ body });
  const [owner, repoName] = repo.split('/');
  const options = {
    hostname: 'api.github.com',
    path:     `/repos/${owner}/${repoName}/issues/${prNumber}/comments`,
    method:   'POST',
    headers:  {
      'Content-Type':  'application/json',
      'User-Agent':    'architecture-linter-action',
      'Authorization': `Bearer ${token}`,
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  const req = https.request(options, res => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log(`PR comment posted (HTTP ${res.statusCode})`);
    } else {
      console.log(`::warning::Failed to post PR comment (HTTP ${res.statusCode})`);
    }
  });
  req.on('error', err => console.log(`::warning::Failed to post PR comment: ${err.message}`));
  req.write(payload);
  req.end();
}

// ── Exit code ─────────────────────────────────────────────────────────────────
if (failOnViolations) {
  process.exitCode = 1;
}
