/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTakeCycleGroupId } from '../src/common/editor/controller/take-cycle-group-id.ts';

test('cycle group IDs reuse the exact same track sequence and loop', () => {
	const project = {
		loop: { startFrame: 100, endFrame: 500 },
		takeGroups: [
			{ id: 'other-loop', sequenceId: 'sequence', trackId: 'track', startSample: 0, endSample: 100 },
			{ id: 'exact-group', sequenceId: 'sequence', trackId: 'track', startSample: 100, endSample: 500 },
		],
	};
	assert.equal(resolveTakeCycleGroupId(project, 'sequence', 'track', () => 'fresh'), 'exact-group');
	assert.equal(resolveTakeCycleGroupId(project, 'sequence', 'new-track', () => 'fresh'), 'fresh');
});

test('cycle group ID resolution fails closed on ambiguous persisted ownership', () => {
	const project = {
		loop: { startFrame: 100, endFrame: 500 },
		takeGroups: [
			{ id: 'first', sequenceId: 'sequence', trackId: 'track', startSample: 100, endSample: 500 },
			{ id: 'second', sequenceId: 'sequence', trackId: 'track', startSample: 100, endSample: 500 },
		],
	};
	assert.throws(
		() => resolveTakeCycleGroupId(project, 'sequence', 'track', () => 'fresh'),
		/ownership is ambiguous/u,
	);
});

test('cycle group ID resolution refuses an overlapping non-exact group before capture', () => {
	const project = {
		loop: { startFrame: 100, endFrame: 500 },
		takeGroups: [
			{ id: 'overlap', sequenceId: 'sequence', trackId: 'track', startSample: 50, endSample: 200 },
		],
	};
	assert.throws(
		() => resolveTakeCycleGroupId(project, 'sequence', 'track', () => 'fresh'),
		/overlaps an existing take group/u,
	);
});
