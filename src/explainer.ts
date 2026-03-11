/**
 * explainer.ts
 *
 * Generates human-readable explanations for architecture violations.
 *
 * Each explanation has three parts:
 *   - why:    the architectural principle behind the rule
 *   - impact: concrete consequence of breaking it
 *   - fix:    actionable suggestion for resolving the violation
 *
 * Explanations are keyed by "sourceLayer → targetLayer". When no specific
 * pair is found, a generic explanation is generated from the rule string.
 */

export interface Explanation {
  why: string;
  impact: string;
  fix: string;
}

type ExplainKey = `${string} → ${string}`;

const EXPLANATIONS: Partial<Record<ExplainKey, Explanation>> = {
  'controller → repository': {
    why:
      'Controllers belong to the HTTP layer — their job is to receive requests, ' +
      'validate input, and delegate work. Repositories belong to the data layer and ' +
      'own all database access. Skipping the service layer couples two concerns ' +
      'that should evolve independently.',
    impact:
      'Business logic leaks into controllers, making them hard to unit-test ' +
      'without a database. Changing your data access strategy (e.g. switching ORMs) ' +
      'will require editing controllers.',
    fix:
      'Move the data access call into a Service class. Inject the Service into the ' +
      'Controller instead of the Repository. The Controller should only call ' +
      'service methods and map the result to an HTTP response.',
  },

  'controller → model': {
    why:
      'Directly coupling a controller to a domain model bypasses the transformation ' +
      'and validation logic that the service layer is responsible for.',
    impact:
      'Input validation, mapping, and business rules get duplicated or scattered ' +
      'across multiple controllers.',
    fix:
      'Use a DTO (Data Transfer Object) at the controller boundary. Let the service ' +
      'map the DTO to the domain model and apply business rules.',
  },

  'service → controller': {
    why:
      'Services represent business logic and should have no knowledge of the ' +
      'HTTP/transport layer. Importing a controller creates an upward dependency ' +
      'that inverts the intended layer hierarchy.',
    impact:
      'The service becomes impossible to reuse outside an HTTP context ' +
      '(e.g. in a CLI command, a queue worker, or a unit test).',
    fix:
      'Remove the controller import from the service. If shared logic is needed, ' +
      'extract it into a separate utility or helper that both layers can import.',
  },

  'repository → service': {
    why:
      'Repositories are the lowest layer — they should only interact with the data ' +
      'store. Importing a service introduces a circular or upward dependency.',
    impact:
      'Creates tight coupling between data access and business logic, and can ' +
      'easily produce circular dependency errors.',
    fix:
      'If the repository needs logic from the service, that logic likely belongs ' +
      'in the repository, or should be moved to a shared domain layer below both.',
  },

  'repository → controller': {
    why:
      'Repositories must not know anything about HTTP controllers. This is a ' +
      'severe layer inversion that breaks the entire dependency flow.',
    impact:
      'The repository becomes untestable and unreusable outside of an HTTP context.',
    fix:
      'Remove the controller import entirely. Restructure the shared logic into ' +
      'a lower-level utility or a dedicated domain service.',
  },

  'middleware → repository': {
    why:
      'Middleware handles cross-cutting concerns (auth, logging, rate-limiting). ' +
      'Direct database access in middleware bypasses the service layer and ' +
      'duplicates data-access logic.',
    impact:
      'Business rules that belong in the service get silently duplicated in ' +
      'middleware, causing inconsistency when one copy is updated and the other is not.',
    fix:
      'Inject a Service into the middleware and call the service method instead ' +
      'of the repository directly.',
  },

  'handler → repository': {
    why:
      'Handlers (event handlers, queue consumers) should delegate persistence ' +
      'work through the service layer, not directly to repositories.',
    impact:
      'Business validation logic gets bypassed when events are processed, ' +
      'potentially allowing invalid state to be persisted.',
    fix:
      'Call the appropriate Service method from the handler. The service owns ' +
      'the business rules that must be enforced before any data is written.',
  },

  'resolver → repository': {
    why:
      'GraphQL resolvers are part of the transport layer. Allowing them to call ' +
      'repositories directly is the GraphQL equivalent of a REST controller ' +
      'bypassing the service layer.',
    impact:
      'Business logic proliferates across resolvers, making it impossible to ' +
      'enforce consistent rules across REST and GraphQL endpoints.',
    fix:
      'Route resolver calls through a Service. The service layer should be ' +
      'the single authoritative source of business logic regardless of transport.',
  },
};

/**
 * Returns a pre-canned or dynamically generated explanation for a violation.
 */
export function explain(sourceLayer: string, targetLayer: string, rule: string): Explanation {
  const key: ExplainKey = `${sourceLayer.toLowerCase()} → ${targetLayer.toLowerCase()}`;
  const known = EXPLANATIONS[key];
  if (known) return known;

  // Generic fallback constructed from the rule string
  const src = capitalise(sourceLayer);
  const tgt = capitalise(targetLayer);

  return {
    why:
      `The architecture rules for this project forbid ${src} from importing ${tgt}. ` +
      `This preserves a clear separation of concerns between the two layers.`,
    impact:
      `Allowing ${src} to depend on ${tgt} introduces coupling that makes both ` +
      `layers harder to change, test, and reason about independently.`,
    fix:
      `Check whether an intermediate layer (e.g. a service) can satisfy the ` +
      `${src}'s needs without accessing ${tgt} directly. ` +
      `If access is genuinely required, consider updating your architecture rules and documenting the decision.`,
  };
}

function capitalise(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
