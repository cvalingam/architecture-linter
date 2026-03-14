/**
 * Formats the layer coupling matrix as a Mermaid or DOT graph.
 *
 * Only edges with at least one import are included in the output.
 */

type CouplingMatrix = Record<string, Record<string, number>>;

/**
 * Renders the coupling matrix as a Mermaid `graph LR` diagram.
 *
 * Example output:
 *   graph LR
 *     controller -->|3| service
 *     service -->|1| repository
 */
export function toMermaid(matrix: CouplingMatrix): string {
  const lines: string[] = ['graph LR'];
  for (const [source, targets] of Object.entries(matrix)) {
    for (const [target, count] of Object.entries(targets)) {
      if (count > 0) {
        lines.push(`  ${sanitiseId(source)} -->|${count}| ${sanitiseId(target)}`);
      }
    }
  }
  return lines.join('\n');
}

/**
 * Renders the coupling matrix as a Graphviz DOT digraph.
 *
 * Example output:
 *   digraph arch {
 *     rankdir=LR;
 *     controller -> service [label="3"];
 *     service -> repository [label="1"];
 *   }
 */
export function toDot(matrix: CouplingMatrix): string {
  const lines: string[] = ['digraph arch {', '  rankdir=LR;'];
  for (const [source, targets] of Object.entries(matrix)) {
    for (const [target, count] of Object.entries(targets)) {
      if (count > 0) {
        lines.push(`  ${sanitiseId(source)} -> ${sanitiseId(target)} [label="${count}"];`);
      }
    }
  }
  lines.push('}');
  return lines.join('\n');
}

/** Replaces characters that are invalid in Mermaid and DOT identifiers. */
function sanitiseId(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}
