/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createVideoShuttleAnchor, resolveAdjacentVideoEditPoint,
	resolveVideoProgramGeometry, resolveVideoShuttlePosition,
} from '../src/common/editor/video-navigation-model.ts';

const RATE = Object.freeze({ num: 30_000, den: 1_001 });

function programme() {
	return {
		id: 'image-programme', sampleRate: 48_000, primarySequenceId: 'main',
		sequences: [{ id: 'main', rate: RATE, trackIds: ['pictures', 'hidden'] }],
		tracks: [
			{ id: 'pictures', type: 'video', clipIds: ['poster', 'camera'] },
			{ id: 'hidden', type: 'video', hidden: true, clipIds: ['hidden-poster'] },
		],
		clips: [
			{ id: 'poster', kind: 'image', sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 150, sourceStartTicks: '1000000' },
			{ id: 'camera', kind: 'video', sequenceId: 'main', sequenceStartFrame: 150, sequenceFrameCount: 30 },
			{ id: 'hidden-poster', kind: 'image', sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 300 },
		],
	};
}

test('an image-only programme has its exact sequence tail and shuttle movement', () => {
	const project = programme();
	project.tracks[0]!.clipIds = ['poster'];
	const geometry = resolveVideoProgramGeometry(project);
	assert.equal(geometry.programEndSequenceFrame, 150);
	assert.equal(geometry.programEndSample, 240_240);
	const anchor = createVideoShuttleAnchor(geometry, 0, 1, 0);
	assert.deepEqual(resolveVideoShuttlePosition(anchor, 1_001), {
		sequenceFrame: 30, sample: 48_048, ended: false,
	});
});

test('picture edit navigation includes both exact image boundaries and adjacent camera edits', () => {
	const project = programme();
	const target = { sequenceId: 'main', videoTrackId: 'pictures', explicit: true };
	assert.equal(resolveAdjacentVideoEditPoint(project, 0, target, 'next'), 240_240);
	assert.equal(resolveAdjacentVideoEditPoint(project, 240_240, target, 'previous'), 0);
	assert.equal(resolveAdjacentVideoEditPoint(project, 240_240, target, 'next'), 288_288);
	assert.equal(resolveAdjacentVideoEditPoint(project, 0, { ...target, videoTrackId: 'hidden' }, 'next'), null);
	assert.equal(resolveAdjacentVideoEditPoint(project, 0, { ...target, videoTrackId: null }, 'next'), null);
	const before = structuredClone(project);
	resolveVideoProgramGeometry(project);
	assert.deepEqual(project, before);
});

test('generators and legacy stills use the same programme clock without source frame assumptions', () => {
	for (const kind of ['generator', 'still']) {
		const project = programme();
		project.tracks[0]!.clipIds = ['poster'];
		project.clips[0]!.kind = kind;
		assert.equal(resolveVideoProgramGeometry(project).programEndSequenceFrame, 150);
		assert.equal(resolveAdjacentVideoEditPoint(project, 0, {
			sequenceId: 'main', videoTrackId: 'pictures', explicit: true,
		}, 'next'), 240_240);
	}
});
