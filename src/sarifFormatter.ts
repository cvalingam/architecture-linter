import { Violation } from './types';

export interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  helpUri: string;
}

export interface SarifResult {
  ruleId: string;
  level: 'error' | 'warning' | 'note';
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: {
        uri: string;
        uriBaseId: string;
      };
    };
  }>;
}

export interface SarifDocument {
  $schema: string;
  version: '2.1.0';
  runs: Array<{
    tool: {
      driver: {
        name: string;
        version: string;
        informationUri: string;
        rules: SarifRule[];
      };
    };
    results: SarifResult[];
  }>;
}

/**
 * Converts architecture violations to a SARIF 2.1.0 document.
 *
 * Compatible with GitHub Code Scanning — upload via the `github/codeql-action/upload-sarif` action.
 * Each unique rule string (e.g. "Controller cannot import Repository") is registered as a
 * distinct rule in the driver's rule list, with a stable ARCH### ID.
 *
 * @param violations  List of violations from the rule engine.
 * @param toolVersion Semver string for the running tool version (e.g. "0.1.5").
 */
export function toSarif(violations: Violation[], toolVersion: string): SarifDocument {
  // Build a registry of unique rules encountered, preserving insertion order.
  const ruleMap = new Map<string, SarifRule>();

  for (const v of violations) {
    if (!ruleMap.has(v.rule)) {
      const idx = ruleMap.size + 1;
      ruleMap.set(v.rule, {
        id: `ARCH${String(idx).padStart(3, '0')}`,
        name: 'LayerViolation',
        shortDescription: { text: v.rule },
        helpUri: 'https://github.com/cvalingam/architecture-linter#rules',
      });
    }
  }

  const rules = [...ruleMap.values()];

  const results: SarifResult[] = violations.map(v => {
    const rule = ruleMap.get(v.rule)!;
    return {
      ruleId: rule.id,
      level: 'error',
      message: {
        text: `${v.rule}: '${v.file}' imports '${v.importPath}' (${v.rawSpecifier})`,
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: v.file,
              uriBaseId: '%SRCROOT%',
            },
          },
        },
      ],
    };
  });

  return {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'architecture-linter',
            version: toolVersion,
            informationUri: 'https://github.com/cvalingam/architecture-linter',
            rules,
          },
        },
        results,
      },
    ],
  };
}
