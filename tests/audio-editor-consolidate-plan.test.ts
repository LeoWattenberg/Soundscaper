/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	type ConsolidateBinding,
	createConsolidatePlan,
} from '../src/common/editor/consolidate-plan.ts';

function binding(sourceId: string, overrides: Partial<ConsolidateBinding> = {}): ConsolidateBinding {
	return {
		sourceId,
		storageKey: `media/${sourceId}`,
		byteLength: 1_000,
		sha256: 'a'.repeat(64),
		bindingToken: `token-${sourceId}`,
		kind: 'audio',
		...overrides,
	};
}

function project(overrides: Record<string, unknown> = {}) {
	return {
		id: 'p', title: 'Consolidate', sampleRate: 48_000,
		sources: [
			{ kind: 'audio', id: 'linked-a', name: 'A' },
			{ kind: 'audio', id: 'linked-b', name: 'B' },
			{ kind: 'audio', id: 'managed', name: 'C' },
		],
		clips: [
			{ kind: 'audio', id: 'c1', sourceId: 'linked-a', durationFrames: 10, sourceStartFrame: 0 },
			{ kind: 'audio', id: 'c2', sourceId: 'linked-b', durationFrames: 10, sourceStartFrame: 0 },
			{ kind: 'audio', id: 'c3', sourceId: 'managed', durationFrames: 10, sourceStartFrame: 0 },
		],
		tracks: [{ type: 'audio', id: 'a1', name: 'A1', clipIds: ['c1', 'c2', 'c3'] }],
		...overrides,
	};
}

const bindings = () => [binding('linked-a'), binding('linked-b', { kind: 'video' })];

test('a source with no binding is already managed and is not copied', () => {
	const plan = createConsolidatePlan({ project: project(), bindings: bindings() });
	const managed = plan.sources.find((entry) => entry.sourceId === 'managed');
	assert.equal(managed?.disposition, 'already-managed');
	assert.deepEqual(plan.copy.map((entry) => entry.sourceId), ['linked-a', 'linked-b']);
	assert.equal(plan.copyByteLength, 2_000);
});

test('the plan carries the binding fence and digest a verified copy needs', () => {
	const plan = createConsolidatePlan({ project: project(), bindings: bindings() });
	const [first] = plan.copy;
	assert.equal(first.bindingToken, 'token-linked-a', 'the rebind must present the compare-and-swap fence');
	assert.equal(first.sha256, 'a'.repeat(64), 'the copy is verified against the digest the binding recorded');
	assert.equal(first.kind, 'audio');
	assert.equal(plan.copy[1].kind, 'video');
});

test('an unreachable original does not stop the run, and the rest still consolidates', () => {
	const plan = createConsolidatePlan({
		project: project(),
		bindings: bindings(),
		isReachable: (entry) => entry.sourceId !== 'linked-b',
	});
	assert.deepEqual(plan.copy.map((entry) => entry.sourceId), ['linked-a']);
	assert.deepEqual(plan.unreachable.map((entry) => entry.sourceId), ['linked-b']);
	const item = plan.report.items.find((entry) => entry.code === 'consolidate.original-unreachable');
	assert.equal(item?.severity, 'error');
	assert.equal(item?.disposition, 'missing');
});

test('incompleteness is on the plan itself, not only buried in the report', () => {
	// The hazard in consolidating partially is someone reading "consolidated"
	// and shipping an archive with holes, so a caller cannot call this a success
	// without stepping over `complete`.
	const partial = createConsolidatePlan({
		project: project(), bindings: bindings(), isReachable: (entry) => entry.sourceId !== 'linked-b',
	});
	assert.equal(partial.complete, false);
	assert.equal(partial.unreachable.length, 1);
	assert.ok(
		partial.report.items.some((entry) => entry.code === 'consolidate.incomplete'),
		'and it is stated once at the top level too, so a summary that reads one item still says so',
	);

	const whole = createConsolidatePlan({ project: project(), bindings: bindings() });
	assert.equal(whole.complete, true);
	assert.equal(whole.unreachable.length, 0);
	assert.equal(
		whole.report.items.some((entry) => entry.code === 'consolidate.incomplete'),
		false,
	);
});

test('a binding whose source is gone is reported rather than copied', () => {
	const plan = createConsolidatePlan({
		project: project({ sources: [{ kind: 'audio', id: 'managed', name: 'C' }] }),
		bindings: bindings(),
	});
	assert.deepEqual(plan.copy, []);
	const stale = plan.sources.filter((entry) => entry.disposition === 'unbound');
	assert.deepEqual(stale.map((entry) => entry.sourceId), ['linked-a', 'linked-b']);
	assert.equal(
		plan.report.items.filter((entry) => entry.code === 'consolidate.binding-without-source').length,
		2,
	);
});

test('an unreferenced source is still consolidated, not quietly dropped', () => {
	// Consolidate makes a project self-contained. Deciding a source is expendable
	// is trim-media's job, and only when the user asked for it.
	const plan = createConsolidatePlan({
		project: project({ clips: [] }),
		bindings: bindings(),
	});
	assert.deepEqual(plan.copy.map((entry) => entry.sourceId), ['linked-a', 'linked-b']);
	assert.equal(
		plan.report.items.filter((entry) => entry.code === 'consolidate.source-unreferenced').length,
		2,
	);
});

test('the report counts agree with its items', () => {
	const plan = createConsolidatePlan({
		project: project(), bindings: bindings(), isReachable: (entry) => entry.sourceId !== 'linked-b',
	});
	for (const disposition of ['preserved', 'converted', 'missing', 'omitted'] as const) {
		assert.equal(
			plan.report.counts[disposition],
			plan.report.items.filter((entry) => entry.disposition === disposition).length,
			`${disposition} count must match its items`,
		);
	}
});

test('the plan refuses contradictory input rather than picking a binding', () => {
	assert.throws(
		() => createConsolidatePlan({
			project: project(), bindings: [binding('linked-a'), binding('linked-a', { storageKey: 'other' })],
		}),
		/more than one linked-original binding/u,
	);
	assert.throws(
		() => createConsolidatePlan({ project: project(), bindings: [binding('')] }),
		/requires a sourceId/u,
	);
	assert.throws(
		() => createConsolidatePlan({ project: null as never, bindings: [] }),
		/requires a project/u,
	);
});
