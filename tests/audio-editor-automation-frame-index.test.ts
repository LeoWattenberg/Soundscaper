/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { automationFrameIndex, automationSpanContains } from '../src/common/editor/ui/timeline/automation-frame-index.ts';
import type { AutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';

const lane: AutomationLaneV21 = { id: 'lane', address: { kind: 'strip', strip: { kind: 'track', id: 'track' }, parameterId: 'pan' },
	timebase: 'absolute-samples', points: [
		{ id: 'a', position: 0, value: -1 }, { id: 'b', position: 50, value: 0 }, { id: 'c', position: 100, value: 1 },
	], segments: [{ kind: 'linear' }, { kind: 'linear' }] };

test('automation frame indexes reuse a snapshot and query inclusive authored boundaries', () => {
	const index = automationFrameIndex(lane, 100);
	assert.equal(automationFrameIndex(lane, 100), index);
	assert.deepEqual(index.between(50, 100).map(point => point.id), ['b', 'c']);
	assert.equal(index.indexByFrame.get(50), 1);
	assert.notEqual(automationFrameIndex(lane, 200), index);
});

test('automation span membership merges overlapping spans while preserving gaps and edges', () => {
	const contains = automationSpanContains([{ startFrame: 50, endFrame: 60 }, { startFrame: 0, endFrame: 20 }, { startFrame: 10, endFrame: 30 }]);
	assert.deepEqual([0, 20, 30, 31, 49, 50, 60, 61].map(contains), [true, true, true, false, false, true, true, false]);
});
