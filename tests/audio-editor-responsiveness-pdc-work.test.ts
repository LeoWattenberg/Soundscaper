/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';

import { compileProjectPdcPlan } from '../src/common/editor/engine/project-pdc-plan.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';

test('PDC preparation avoids intermediate track projections and preserves filtered fallback indexes', () => {
	const tracks = [
		{ type: 'label', id: 'label' }, { type: 'audio' }, { type: 'video', id: 'video' },
		{ type: 'audio', id: 'last' },
	];
	tracks.filter = () => { throw new Error('PDC allocated an intermediate track projection'); };
	const project = { sampleRate: 48_000, tracks, mixer: { groups: [], sends: [] } } as unknown as EngineProject;
	assert.deepEqual([...compileProjectPdcPlan(project).trackLatencyFrames], [['0', 0], ['last', 0]]);
	assert.deepEqual([...compileProjectPdcPlan(project, { trackId: 0, fallbackTrackIndexIds: true }).trackLatencyFrames], [['0', 0]]);
	assert.deepEqual([...compileProjectPdcPlan(project, { trackId: 0 }).trackLatencyFrames], []);
	assert.equal(compileProjectPdcPlan(project).latencyFrames, 0);
});

test('PDC maxima support large projects without spreading the map into an argument list', () => {
	const project = { sampleRate: 48_000, tracks: Array.from({ length: 150_000 }, (_, index) => ({
		type: 'audio', id: String(index), effects: [],
	})), mixer: { groups: [], sends: [] } } as unknown as EngineProject;
	const plan = compileProjectPdcPlan(project);
	assert.equal(plan.trackLatencyFrames.size, 150_000);
	assert.equal(plan.maximumTrackLatencyFrames, 0);
});
