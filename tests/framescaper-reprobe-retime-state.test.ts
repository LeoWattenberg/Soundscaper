/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

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
