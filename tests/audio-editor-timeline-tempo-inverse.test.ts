/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sampleFrameToBeat } from '../src/common/editor/timeline-tempo-inverse.ts';
import { beatToSampleFrame } from '../src/common/editor/timeline-time.ts';

test('maximum-size tempo maps invert one frame without quadratic event projections', () => {
	const tempoMap = {
		mode: 'musical' as const,
		events: Array.from({ length: 4_096 }, (_, index) => ({
			id: `tempo-${String(index)}`,
			beat: { num: index * 4, den: 1 },
			bpm: { num: index % 2 ? 90 : 120, den: 1 },
		})),
	};
	const targetBeat = { num: 4_095 * 4 + 1, den: 1 };
	const targetFrame = beatToSampleFrame(targetBeat, tempoMap, 48_000);
	const startedAt = performance.now();
	const resolved = sampleFrameToBeat(targetFrame, tempoMap, 48_000);
	const elapsed = performance.now() - startedAt;
	assert.deepEqual(resolved, targetBeat);
	assert.ok(elapsed < 750, `tempo-map inversion took ${String(Math.round(elapsed))} ms`);
});
