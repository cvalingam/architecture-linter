import { toSarif } from '../sarifFormatter';
import { Violation } from '../types';

function makeViolation(
  file = 'src/controllers/ctrl.ts',
  importPath = 'src/repositories/repo',
  rule = 'Controller cannot import Repository',
): Violation {
  return { file, importPath, rawSpecifier: '../repositories/repo', sourceLayer: 'controller', targetLayer: 'repository', rule };
}

describe('toSarif', () => {
  it('returns a SARIF 2.1.0 document with the correct schema and version', () => {
    const doc = toSarif([], '0.1.5');
    expect(doc.version).toBe('2.1.0');
    expect(doc.$schema).toContain('sarif-schema-2.1.0');
  });

  it('produces exactly one run', () => {
    const doc = toSarif([], '0.1.5');
    expect(doc.runs).toHaveLength(1);
  });

  it('sets the driver name and version', () => {
    const doc = toSarif([], '1.2.3');
    const { driver } = doc.runs[0].tool;
    expect(driver.name).toBe('architecture-linter');
    expect(driver.version).toBe('1.2.3');
  });

  it('returns no results when violations array is empty', () => {
    const doc = toSarif([], '0.1.5');
    expect(doc.runs[0].results).toHaveLength(0);
    expect(doc.runs[0].tool.driver.rules).toHaveLength(0);
  });

  it('maps each violation to a SARIF result', () => {
    const doc = toSarif([makeViolation()], '0.1.5');
    expect(doc.runs[0].results).toHaveLength(1);
  });

  it('result level is "error"', () => {
    const doc = toSarif([makeViolation()], '0.1.5');
    expect(doc.runs[0].results[0].level).toBe('error');
  });

  it('result message contains the rule string', () => {
    const v = makeViolation();
    const doc = toSarif([v], '0.1.5');
    expect(doc.runs[0].results[0].message.text).toContain(v.rule);
  });

  it('result location uri matches violation file path', () => {
    const v = makeViolation('src/controllers/ctrl.ts');
    const doc = toSarif([v], '0.1.5');
    const loc = doc.runs[0].results[0].locations[0].physicalLocation.artifactLocation;
    expect(loc.uri).toBe('src/controllers/ctrl.ts');
    expect(loc.uriBaseId).toBe('%SRCROOT%');
  });

  it('registers each unique rule exactly once in driver.rules', () => {
    const violations = [
      makeViolation('ctrl.ts', 'repo.ts', 'Controller cannot import Repository'),
      makeViolation('ctrl2.ts', 'repo2.ts', 'Controller cannot import Repository'), // same rule
      makeViolation('svc.ts', 'repo.ts', 'Service cannot import Repository'),       // different rule
    ];
    const doc = toSarif(violations, '0.1.5');
    expect(doc.runs[0].tool.driver.rules).toHaveLength(2);
    expect(doc.runs[0].results).toHaveLength(3);
  });

  it('assigns stable ARCH### ids to rules starting at ARCH001', () => {
    const doc = toSarif([makeViolation()], '0.1.5');
    expect(doc.runs[0].tool.driver.rules[0].id).toBe('ARCH001');
  });

  it('second unique rule gets ARCH002', () => {
    const violations = [
      makeViolation('a.ts', 'b.ts', 'Controller cannot import Repository'),
      makeViolation('c.ts', 'd.ts', 'Service cannot import Repository'),
    ];
    const doc = toSarif(violations, '0.1.5');
    const ids = doc.runs[0].tool.driver.rules.map(r => r.id);
    expect(ids).toContain('ARCH001');
    expect(ids).toContain('ARCH002');
  });

  it('each result references the correct ruleId', () => {
    const violations = [
      makeViolation('a.ts', 'b.ts', 'Controller cannot import Repository'),
      makeViolation('c.ts', 'd.ts', 'Service cannot import Repository'),
    ];
    const doc = toSarif(violations, '0.1.5');
    const ruleIds = new Set(doc.runs[0].tool.driver.rules.map(r => r.id));
    for (const result of doc.runs[0].results) {
      expect(ruleIds.has(result.ruleId)).toBe(true);
    }
  });

  it('rule shortDescription matches the violation rule string', () => {
    const v = makeViolation();
    const doc = toSarif([v], '0.1.5');
    expect(doc.runs[0].tool.driver.rules[0].shortDescription.text).toBe(v.rule);
  });

  it('driver informationUri points to the repository', () => {
    const doc = toSarif([], '0.1.5');
    expect(doc.runs[0].tool.driver.informationUri).toContain('architecture-linter');
  });
});
