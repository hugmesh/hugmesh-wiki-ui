#!/usr/bin/env node
/**
 * Assert the committed `openapi.json` still matches hugmesh-wiki-bff-api's current
 * spec — the drift gate for #24.
 *
 * WHY THIS EXISTS: `openapi.json` in this repo is the ng-openapi-gen INPUT
 * (`ng-openapi-gen.json` -> `"input": "openapi.json"`), refreshed only by the
 * manual `npm run gen:spec` (`cp <bff-spec> openapi.json && npm run gen`). Nothing
 * ever failed when that copy went stale: `git log --oneline -- openapi.json` showed
 * a single commit since the repo's initial public release, and it had measurably
 * drifted (missing the `/bff/wiki/superadmin/brands` path and the `AuditEntry`,
 * `AuditList`, `Brands` schemas — see #24). This script is the CI-facing check that
 * makes that kind of drift a build failure instead of a silent gap, mirroring the
 * BFF side's own `OpenApiSpecDumpTest` (assert-by-default, only ever rewritten by
 * a deliberate `-Dopenapi.spec.write=true` run — see that test's own doc comment
 * for why "assert by default" was the hard-won lesson).
 *
 * WHAT IT DOES: re-reads the BFF's spec from the same source `npm run gen:spec`
 * copies from (default: the sibling checkout `../hugmesh-wiki-bff-api/...`,
 * overridable with WIKI_BFF_SPEC exactly like `gen:spec`), then compares it against
 * the COMMITTED `openapi.json` structurally (parsed + key-sorted JSON, so harmless
 * whitespace/ordering differences never false-positive) and fails naming every
 * path/schema that differs if they disagree.
 *
 * WHAT IT DOES NOT DO: it never writes `openapi.json`. Refreshing the contract is
 * still the deliberate `npm run gen:spec` step; this only asserts the two agree.
 *
 *   node scripts/assert-spec-sync.mjs
 *   WIKI_BFF_SPEC=/path/to/openapi.json node scripts/assert-spec-sync.mjs
 */
import { existsSync, readFileSync } from 'node:fs';

const COMMITTED_PATH = 'openapi.json';
const sourcePath = process.env.WIKI_BFF_SPEC
  ?? '../hugmesh-wiki-bff-api/src/main/resources/openapi/openapi.json';

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!existsSync(sourcePath)) {
  fail(
    `spec drift gate: source spec not found at ${sourcePath}\n`
    + 'Run `./mvnw -Dtest=OpenApiSpecDumpTest test` in hugmesh-wiki-bff-api first, '
    + 'or set WIKI_BFF_SPEC to its committed openapi.json.',
  );
}

if (!existsSync(COMMITTED_PATH)) {
  fail(`spec drift gate: committed ${COMMITTED_PATH} is MISSING. Run \`npm run gen:spec\`.`);
}

let source;
let committed;
try {
  source = JSON.parse(readFileSync(sourcePath, 'utf8'));
} catch (err) {
  fail(`spec drift gate: could not parse ${sourcePath} as JSON: ${err.message}`);
}
try {
  committed = JSON.parse(readFileSync(COMMITTED_PATH, 'utf8'));
} catch (err) {
  fail(`spec drift gate: could not parse ${COMMITTED_PATH} as JSON: ${err.message}`);
}

/** Deterministic stringify: sorts object keys recursively so key-order-only
 *  differences (and pretty-print whitespace) never false-positive the diff. */
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const sourcePaths = new Set(Object.keys(source.paths ?? {}));
const committedPaths = new Set(Object.keys(committed.paths ?? {}));
const missingPaths = [...sourcePaths].filter((p) => !committedPaths.has(p));
const extraPaths = [...committedPaths].filter((p) => !sourcePaths.has(p));

const sourceSchemas = new Set(Object.keys(source.components?.schemas ?? {}));
const committedSchemas = new Set(Object.keys(committed.components?.schemas ?? {}));
const missingSchemas = [...sourceSchemas].filter((s) => !committedSchemas.has(s));
const extraSchemas = [...committedSchemas].filter((s) => !sourceSchemas.has(s));

const structurallyEqual = stableStringify(source) === stableStringify(committed);

if (!structurallyEqual) {
  const lines = [
    `spec drift gate: committed ${COMMITTED_PATH} no longer matches ${sourcePath}.`,
    'Refresh it with `npm run gen:spec` (set WIKI_BFF_SPEC if the BFF spec lives '
    + 'somewhere other than the default sibling checkout) and commit the result.',
  ];
  if (missingPaths.length) lines.push(`Missing paths (in BFF, not in committed): ${missingPaths.join(', ')}`);
  if (extraPaths.length) lines.push(`Extra paths (in committed, not in BFF): ${extraPaths.join(', ')}`);
  if (missingSchemas.length) lines.push(`Missing schemas (in BFF, not in committed): ${missingSchemas.join(', ')}`);
  if (extraSchemas.length) lines.push(`Extra schemas (in committed, not in BFF): ${extraSchemas.join(', ')}`);
  if (!missingPaths.length && !extraPaths.length && !missingSchemas.length && !extraSchemas.length) {
    lines.push('Paths and top-level schema names match; the drift is in operation/schema bodies (parameters, descriptions, property types, ...).');
  }
  fail(lines.join('\n'));
}

console.log(`spec drift gate: ${COMMITTED_PATH} matches ${sourcePath} (${committedPaths.size} paths, ${committedSchemas.size} schemas).`);
