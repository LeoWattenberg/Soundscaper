/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeVideoRetimeCurveV16 } from '../src/common/editor/video-retime-v16.ts';
import { conformFramescaperVideoRetimeSnapshotsForReprobeRetime } from
	'../src/framescaper/editor-project-retime-retime-state.ts';

const snapshot = Object.freeze({
	id: 'clip',
	retimeMap: Object.freeze({
		feature: 'video-retime' as const,
		version: 2 as const,
		points: Object.freeze([
			Object.freeze({ outerFrame: 0, sourceFrame: Object.freeze({ num: 0, den: 1 }) }),
			Object.freeze({ outerFrame: 10, sourceFrame: Object.freeze({ num: 5, den: 1 }) }),
		]),
		segments: Object.freeze([Object.freeze({ mode: 'constant-forward' as const })]),
	}),
});

function project(rate: number): Record<string, unknown> {
	return {
		sources: [{ id: 'source', kind: 'video', frameRate: { num: rate, den: 1 } }],
		clips: [{
			id: 'clip', kind: 'video', sourceId: 'source',
			sourceInFrame: 0, sourceFrameCount: 20,
		}],
		projectBin: { clips: [] },
	};
}

test('re-probe retime conformance inspects source commands inside batches', () => {
	const conformed = conformFramescaperVideoRetimeSnapshotsForReprobeRetime(
		project(10),
		project(20),
		{ type: 'batch', commands: [{ type: 'source/reprobe', sourceId: 'source' }] },
		[snapshot],
	);
	assert.deepEqual(conformed[0]?.retimeMap.points[1]?.sourceFrame, { num: 10, den: 1 });
});

test('re-probe retime conformance rescales ramp velocities with source points', () => {
	const ramp = Object.freeze({
		id: 'clip',
		retimeMap: Object.freeze({
			feature: 'video-retime' as const,
			version: 2 as const,
			points: Object.freeze([
				Object.freeze({ outerFrame: 0, sourceFrame: Object.freeze({ num: 0, den: 1 }) }),
				Object.freeze({ outerFrame: 10, sourceFrame: Object.freeze({ num: 10, den: 1 }) }),
			]),
			segments: Object.freeze([Object.freeze({
				mode: 'ramp-forward' as const,
				startVelocity: Object.freeze({ num: 1, den: 1 }),
				endVelocity: Object.freeze({ num: 1, den: 1 }),
			})]),
		}),
	});
	const conformed = conformFramescaperVideoRetimeSnapshotsForReprobeRetime(
		project(10), project(20), { type: 'source/reprobe', sourceId: 'source' }, [ramp],
	);
	const segment = conformed[0]?.retimeMap.segments[0];
	assert.equal(segment?.mode, 'ramp-forward');
	if (segment?.mode !== 'ramp-forward') assert.fail('expected a ramp segment');
	assert.deepEqual(segment.startVelocity, { num: 2, den: 1 });
	assert.deepEqual(segment.endVelocity, { num: 2, den: 1 });
	assert.doesNotThrow(() => normalizeVideoRetimeCurveV16(conformed[0]?.retimeMap, {
		sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 20,
	}));
});
