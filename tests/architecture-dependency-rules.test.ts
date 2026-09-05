/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

/**
 * What the architecture gate is configured to see, pinned so it cannot quietly stop.
 *
 * One of its settings is invisible in its effect when it is wrong. Without
 * `tsPreCompilationDeps`, dependency-cruiser never runs its tsc extractor, so an
 * `import type` edge is not in the graph at all: `editor-core-does-not-import-ui` sat
 * at severity error for the whole time `controller/` read the assistance vocabulary out
 * of `ui/` across sixteen type-only edges, and reported nothing. That failure produces
 * no violation to notice - it produces a clean run - so this file asserts the
 * configuration itself.
 */

const CONFIGURATION = createRequire(import.meta.url)('../.dependency-cruiser.cjs') as {
	readonly forbidden: readonly {
		readonly name: string;
		readonly comment?: string;
		readonly severity: string;
		readonly from: Readonly<Record<string, unknown>>;
		readonly to: Readonly<Record<string, unknown>>;
	}[];
	readonly options: Readonly<Record<string, unknown>>;
};

function rule(name: string) {
	const found = CONFIGURATION.forbidden.find((candidate) => candidate.name === name);
	assert.ok(found, `${name} must be a forbidden rule`);
	return found;
}

test('the cruiser extracts type-only edges, so the layering rules can see them', () => {
	assert.equal(CONFIGURATION.options.tsPreCompilationDeps, true);
});

test('every rule is an error, so none of them degrades to advice', () => {
	for (const forbidden of CONFIGURATION.forbidden) {
		assert.equal(forbidden.severity, 'error', forbidden.name);
	}
});

test('no-circular forbids the cycles that survive compilation and says why the rest pass', () => {
	// A ring containing an erased edge is open at runtime, so it is not the
	// initialization-order hazard the rule exists for. Dropping `viaOnly` would report
	// every type-level cycle in the repository, and the recovery from that would be to
	// lower the severity - which is how the rule stops guarding the case that matters.
	const circular = rule('no-circular');
	assert.deepEqual(circular.to.viaOnly, { dependencyTypesNot: ['type-only'] });
	assert.match(String(circular.comment), /type-only|import type/u);
});

test('the layering rules name both editor boundaries and the test boundary', () => {
	assert.deepEqual(rule('editor-core-does-not-import-ui').from, { path: '^src/common/editor/(?!ui/)' });
	assert.deepEqual(rule('editor-core-does-not-import-ui').to, { path: '^src/common/editor/ui/' });
	assert.deepEqual(rule('production-does-not-import-tests').to, { path: '^tests/' });
	assert.ok(rule('editor-implementation-does-not-import-facade'));
});
