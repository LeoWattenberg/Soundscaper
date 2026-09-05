/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * What the architecture gate is configured to see, pinned so it cannot quietly stop.
 *
 * Two of its settings are invisible in their effect when they are wrong. Without
 * `tsPreCompilationDeps`, dependency-cruiser never runs its tsc extractor, so an
 * `import type` edge is not in the graph at all: `editor-core-does-not-import-ui` sat
 * at severity error for the whole time `controller/` read the assistance vocabulary out
 * of `ui/` across sixteen type-only edges, and reported nothing. And the cruise is
 * scoped by the directories the script names, so `desktop/` and `native/` had no rule
 * applied to them at all while the configuration listed four.
 *
 * Neither failure produces a violation to notice - both produce a clean run - so this
 * file asserts the configuration itself.
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
	assert.match(
		(rule('editor-core-does-not-import-ui').from as { readonly path: string }).path,
		/\^\(\?:src\/common\/editor\/\(\?!ui\/\)/u,
	);
	assert.deepEqual(rule('editor-core-does-not-import-ui').to, { path: '^src/common/editor/ui/' });
	assert.deepEqual(rule('production-does-not-import-tests').to, { path: '^tests/' });
	assert.ok(rule('editor-implementation-does-not-import-facade'));
});

test('check:architecture cruises every maintained source tree', () => {
	// desktop/ and native/ were outside the gate entirely: the script named only src/, so
	// 512 and 221 source files were governed by nothing, and the boundary between them
	// and the browser was two-way with no rule in either direction.
	const manifest = JSON.parse(readFileSync(
		fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
			readonly scripts: Readonly<Record<string, string>>;
		};
	const script = manifest.scripts['check:architecture'];
	assert.ok(script, 'check:architecture must exist');
	const cruise = /dependency-cruiser ([^&|]+)/u.exec(script);
	assert.ok(cruise, `check:architecture must run dependency-cruiser, got ${script}`);
	assert.deepEqual(cruise[1]!.trim().split(/\s+/u), ['src', 'desktop', 'native']);
});

test('the desktop boundary is one-way, and names what src may read', () => {
	// The allow-list is the point: desktop/ is half shared contract and half Electron main
	// process, and before these rules nothing said which half a src/ module had reached.
	const shared = rule('src-imports-only-shared-desktop-contracts');
	assert.deepEqual(shared.from, { path: '^src/' });
	const allowed = (shared.to as { readonly pathNot: readonly string[] }).pathNot;
	assert.equal(allowed.length, 8);
	for (const entry of allowed) assert.match(entry, /^\^desktop\//u);
	assert.equal((shared.to as { readonly path: string }).path, '^desktop/');
});

test('main-process-only desktop modules are named, and the naming keeps itself honest', () => {
	// "Main-process-only" is defined mechanically: these are the desktop modules that
	// import electron, so they cannot be loaded from a page. `renderer-does-not-import-
	// electron` is what stops the list going stale - a shared contract that acquires an
	// electron import fails the cruise rather than quietly becoming unloadable.
	const mainProcess = rule('src-does-not-import-desktop-main-process');
	const named = (mainProcess.to as { readonly path: readonly string[] }).path;
	assert.ok(Array.isArray(named) && named.length >= 16);
	for (const entry of named) assert.match(entry, /^\^desktop\//u);
	const electron = rule('renderer-does-not-import-electron');
	assert.deepEqual(electron.from, { path: '^src/' });
	assert.equal((electron.to as { readonly path: string }).path, '(?:^|/)electron(?:/|$)');
});

test('the tests boundary and the ui boundary cover the desktop and native trees', () => {
	assert.equal(
		(rule('production-does-not-import-tests').from as { readonly path: string }).path,
		'^(?:src|desktop|native)/',
	);
	assert.match(
		(rule('editor-core-does-not-import-ui').from as { readonly path: string }).path,
		/desktop\/\|native\//u,
	);
});
