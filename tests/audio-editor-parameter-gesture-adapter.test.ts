/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ParameterGesturePreviewSupersededError,
	createParameterGestureAdapter,
	type ParameterGestureTarget,
} from '../src/common/editor/controller/parameter-gesture-adapter.ts';
import {
	EditorProjectChangedError,
	EditorProjectGeneration,
} from '../src/common/editor/controller/lifecycle.ts';

interface Value {
	readonly amount: number;
}

test('generic gestures preview runtime-only and commit one normalized value', () => {
	const harness = createHarness();
	assert.deepEqual(harness.adapter.begin('target-1'), { amount: 1 });
	assert.equal(harness.adapter.preview('target-1', { amount: 2 }), 1);
	assert.deepEqual(harness.target.value, { amount: 1 });
	assert.deepEqual(harness.previews, [{ value: { amount: 2 }, revision: 1 }]);

	assert.deepEqual(harness.adapter.commit('target-1', { amount: 3 }), { amount: 3 });
	assert.deepEqual(harness.target.value, { amount: 3 });
	assert.equal(harness.commits, 1);
	assert.equal(harness.sessions.size, 0);
	assert.deepEqual(harness.previews.at(-1), { value: { amount: 3 }, revision: 2 });

	const original = harness.adapter.begin('target-1');
	assert.deepEqual(harness.adapter.commit('target-1', original), { amount: 3 });
	assert.equal(harness.commits, 1);

	harness.adapter.begin('target-1');
	harness.adapter.preview('target-1', { amount: 8 });
	assert.deepEqual(harness.adapter.commit('target-1', { amount: 3 }), { amount: 3 });
	assert.equal(harness.commits, 1);
	assert.deepEqual(harness.previews.at(-1)?.value, { amount: 3 });
});

test('generic gestures cancel safely and roll back an adopted failed commit', () => {
	const harness = createHarness();
	harness.adapter.begin('target-1');
	harness.adapter.preview('target-1', { amount: 2 });
	assert.equal(harness.adapter.cancel('target-1'), 2);
	assert.deepEqual(harness.previews.at(-1), { value: { amount: 1 }, revision: 2 });

	harness.adapter.begin('target-1');
	harness.failCommit = true;
	assert.throws(() => harness.adapter.commit('target-1', { amount: 4 }), /commit failed/iu);
	assert.deepEqual(harness.previews.at(-1), { value: { amount: 1 }, revision: 4 });
	assert.deepEqual(harness.target.value, { amount: 1 });
	assert.equal(harness.sessions.size, 0);
});

test('generic gestures reject switched projects, replaced targets, and stale acknowledgements', () => {
	const harness = createHarness();
	harness.adapter.begin('target-1');
	harness.generation.invalidate();
	harness.generation.activate('project-b');
	assert.throws(() => harness.adapter.preview('target-1', { amount: 2 }), EditorProjectChangedError);
	assert.equal(harness.sessions.size, 0);

	harness.adapter.begin('target-1');
	harness.target = { ...harness.target, revision: 'revision-2' };
	assert.throws(() => harness.adapter.preview('target-1', { amount: 2 }), /changed/iu);
	assert.equal(harness.sessions.size, 0);

	harness.target = { ...harness.target, revision: 'revision-3' };
	harness.adapter.begin('target-1');
	harness.nextAcknowledgement = 4;
	harness.adapter.preview('target-1', { amount: 2 });
	harness.nextAcknowledgement = 4;
	assert.throws(
		() => harness.adapter.preview('target-1', { amount: 3 }),
		ParameterGesturePreviewSupersededError,
	);
	assert.equal(harness.sessions.size, 0);
});

function createHarness() {
	const generation = new EditorProjectGeneration();
	generation.activate('project-a');
	const sessions = new Map();
	let target: ParameterGestureTarget<Value> = {
		identity: 'target-1', revision: 'revision-1', value: { amount: 1 },
	};
	let nextAcknowledgement = 1;
	let commits = 0;
	let failCommit = false;
	const previews: Array<{ value: Value; revision: number }> = [];
	const adapter = createParameterGestureAdapter({
		sessions,
		captureProject: () => generation.capture(),
		assertProject: (token) => generation.assertCurrent(token),
		resolveTarget: (identity) => identity === target.identity ? target : null,
		normalize: (_current, value) => ({ amount: Math.max(0, Number(value.amount)) }),
		valuesEqual: (left, right) => left.amount === right.amount,
		applyPreview: (_current, value) => {
			const revision = nextAcknowledgement++;
			previews.push({ value: structuredClone(value), revision });
			return revision;
		},
		commitValue: (_current, value) => {
			commits += 1;
			if (failCommit) throw new Error('commit failed');
			target = { ...target, value: structuredClone(value), revision: `commit-${commits}` };
			return structuredClone(value);
		},
		currentValue: () => structuredClone(target.value),
		createTargetMissingError: () => new Error('target missing'),
		createTargetChangedError: () => new Error('target changed'),
	});
	return {
		adapter,
		generation,
		previews,
		sessions,
		get target() { return target; },
		set target(value: ParameterGestureTarget<Value>) { target = value; },
		get commits() { return commits; },
		set failCommit(value: boolean) { failCommit = value; },
		set nextAcknowledgement(value: number) { nextAcknowledgement = value; },
	};
}
