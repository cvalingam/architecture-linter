import { toMermaid, toDot } from '../graphFormatter';

type Matrix = Record<string, Record<string, number>>;

function makeMatrix(): Matrix {
  return {
    controller: { controller: 0, service: 3, repository: 0 },
    service:    { controller: 0, service: 0, repository: 1 },
    repository: { controller: 0, service: 0, repository: 0 },
  };
}

// ── toMermaid ─────────────────────────────────────────────────────────────────

describe('toMermaid', () => {
  it('starts with "graph LR"', () => {
    expect(toMermaid(makeMatrix())).toMatch(/^graph LR/);
  });

  it('includes edges with non-zero counts', () => {
    const output = toMermaid(makeMatrix());
    expect(output).toContain('controller -->|3| service');
    expect(output).toContain('service -->|1| repository');
  });

  it('omits edges with zero counts', () => {
    const output = toMermaid(makeMatrix());
    expect(output).not.toContain('controller -->|0|');
    expect(output).not.toContain('repository -->');
  });

  it('returns only the header line for an empty matrix', () => {
    const output = toMermaid({});
    expect(output.trim()).toBe('graph LR');
  });

  it('returns only the header line when all counts are zero', () => {
    const zero: Matrix = { a: { b: 0 }, b: { a: 0 } };
    expect(toMermaid(zero).trim()).toBe('graph LR');
  });

  it('sanitises layer names with special characters', () => {
    const matrix: Matrix = { 'src/controllers': { 'src/services': 2 } };
    const output = toMermaid(matrix);
    // Special chars replaced with _
    expect(output).toContain('src_controllers -->|2| src_services');
  });
});

// ── toDot ─────────────────────────────────────────────────────────────────────

describe('toDot', () => {
  it('starts with "digraph arch {"', () => {
    expect(toDot(makeMatrix())).toMatch(/^digraph arch \{/);
  });

  it('includes "rankdir=LR;"', () => {
    expect(toDot(makeMatrix())).toContain('rankdir=LR;');
  });

  it('includes edges with non-zero counts and label', () => {
    const output = toDot(makeMatrix());
    expect(output).toContain('controller -> service [label="3"];');
    expect(output).toContain('service -> repository [label="1"];');
  });

  it('omits edges with zero counts', () => {
    const output = toDot(makeMatrix());
    expect(output).not.toContain('[label="0"]');
    expect(output).not.toContain('repository ->');
  });

  it('ends with closing "}"', () => {
    const output = toDot(makeMatrix());
    expect(output.trimEnd()).toMatch(/\}$/);
  });

  it('returns a minimal digraph for an empty matrix', () => {
    const output = toDot({});
    expect(output).toContain('digraph arch {');
    expect(output).toContain('}');
    expect(output).not.toContain('->');
  });
});
