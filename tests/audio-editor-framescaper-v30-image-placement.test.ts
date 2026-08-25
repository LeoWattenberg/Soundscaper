/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperImageBatchPlacementV30 } from '../src/framescaper/editor-image-placement-v30.ts';
import { FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v30.ts';
import { createFramescaperProjectV30 } from '../src/framescaper/editor-project-v30.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

test('V30 image batches prefer the selected unlocked collision-free video lane', () => {
	const project = selectedTrackProject();
	const plan = createFramescaperImageBatchPlacementV30(project, {
		sequenceStartFrame: 10,
		sequenceFrameCounts: [50, 3],
		createId: () => 'unused-track',
	});
	assert.equal(plan.trackId, 'video-track');
	assert.equal(plan.trackCommand, null);
	assert.deepEqual(plan.placements, [
		{ sequenceStartFrame: 10, sequenceFrameCount: 50 },
		{ sequenceStartFrame: 60, sequenceFrameCount: 3 },
	]);
});

test('V30 image batches create one Images lane when the complete range collides', () => {
	const project = selectedTrackProject();
	const plan = createFramescaperImageBatchPlacementV30(project, {
		sequenceStartFrame: 5,
		sequenceFrameCounts: [2, 4],
		createId: (prefix) => `${prefix}-new`,
	});
	assert.equal(plan.trackId, 'image-track-new');
	assert.deepEqual(plan.trackCommand, {
		type: 'track/add',
		track: {
			id: 'image-track-new', name: 'Images', type: 'video', clipIds: [],
			mute: false, solo: false, height: 120, collapsed: false,
			laneGroupId: null, hidden: false, opaqueExtensions: {},
		},
		index: 2,
	});
	assert.deepEqual(plan.placements, [
		{ sequenceStartFrame: 5, sequenceFrameCount: 2 },
		{ sequenceStartFrame: 7, sequenceFrameCount: 4 },
	]);
});

test('V30 image batches use another suitable lane before creating one', () => {
	const options = framescaperV20Options();
	const tracks = options.tracks as Array<Record<string, unknown>>;
	tracks.push({
		...tracks[0], id: 'clear-video-track', name: 'Overlay', clipIds: [], locked: false,
	});
	const sequences = options.sequences as Array<Record<string, unknown>>;
	sequences[0] = {
		...sequences[0], trackIds: [...(sequences[0]!.trackIds as string[]), 'clear-video-track'],
	};
	const project = createFramescaperProjectV30(FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE, options);
	const plan = createFramescaperImageBatchPlacementV30(project, {
		sequenceStartFrame: 5, sequenceFrameCounts: [10], createId: () => 'unused',
	});
	assert.equal(plan.trackId, 'clear-video-track');
	assert.equal(plan.trackCommand, null);
});

test('V30 image placement rejects empty, overflowing, and non-positive batches', () => {
	const project = selectedTrackProject();
	for (const sequenceFrameCounts of [[], [0], [-1], [Number.MAX_SAFE_INTEGER]] as const) {
		assert.throws(() => createFramescaperImageBatchPlacementV30(project, {
			sequenceStartFrame: 1,
			sequenceFrameCounts,
			createId: () => 'image-track',
		}), /batch|frame|range|positive/iu);
	}
});

function selectedTrackProject() {
	const project = createFramescaperProjectV30(
		FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE,
		framescaperV20Options(),
	);
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	const selection = draft.selection as Record<string, unknown>;
	selection.trackIds = ['video-track'];
	return draft;
}
