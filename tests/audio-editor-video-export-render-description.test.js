/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { createVideoExportPlan } from '../src/common/editor/video-export.js';

test('video export V6 carries the timeline render description unchanged into its filter plan', () => {
	const project = singleClipProject();
	project.clips[0].videoComposition = composition({
		crop: { left: 0.1, top: 0.2, right: 0.3, bottom: 0.4 },
		transform: { positionX: 0.75, positionY: 0.25, flipHorizontal: true },
		opacity: 0.4,
		blendMode: 'multiply',
		compositingOrder: 7,
	});
	const plan = createVideoExportPlan(project, {
		includeAudio: false,
		range: { startFrame: 0, endFrame: 1_000 },
	});
	const clip = plan.intervals[0].layers[0].clips[0];
	const filterClip = plan.filterPlan.intervals[0].layers[0].clips[0];

	assert.equal(plan.version, 6);
	assert.deepEqual(
		clip.renderDescription.crop.normalized,
		{ left: 0.1, top: 0.2, right: 0.3, bottom: 0.4 },
	);
	assert.deepEqual({
		x: clip.renderDescription.crop.sourcePixels.x,
		y: clip.renderDescription.crop.sourcePixels.y,
		width: Number(clip.renderDescription.crop.sourcePixels.width.toFixed(6)),
		height: clip.renderDescription.crop.sourcePixels.height,
	}, { x: 384, y: 432, width: 2_304, height: 864 });
	assert.deepEqual(clip.renderDescription.sourceDisplayToCanvas, [
		-1 / 3, 0, 0, 1 / 3, 1_600, -180,
	]);
	assert.equal(clip.opacityStart, 0.4);
	assert.equal(clip.opacityEnd, 0.4);
	assert.equal(clip.renderDescription.opacityStart, 0.4);
	assert.equal(clip.renderDescription.opacityEnd, 0.4);
	assert.equal(clip.renderDescription.blendMode, 'multiply');
	assert.equal(clip.renderDescription.compositingOrder, 7);
	assert.strictEqual(filterClip.renderDescription, clip.renderDescription);
	assert.equal(Object.isFrozen(clip.renderDescription), true);
	assert.deepEqual(JSON.parse(JSON.stringify(clip.renderDescription)), clip.renderDescription);
});

function singleClipProject() {
	return {
		sampleRate: 1_000,
		selection: { startFrame: 0, endFrame: 0 },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [{
			kind: 'video',
			id: 'source-1',
			name: 'Source',
			mimeType: 'video/mp4',
			storageKey: 'media/source-1',
			frameCount: 10_000,
			sampleRate: 1_000,
			width: 3_840,
			height: 2_160,
			frameRate: 30,
			videoCodec: 'h264',
			audioCodec: 'aac',
			hasAudio: false,
			posterStorageKey: null,
			thumbnailStorageKey: null,
		}],
		clips: [{
			kind: 'video',
			id: 'clip-1',
			sourceId: 'source-1',
			title: 'Clip',
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			sourceDurationFrames: 10_000,
			durationFrames: 10_000,
			trimStartFrames: 0,
			trimEndFrames: 0,
			speedRatio: 1,
			groupId: null,
			avLinkId: null,
			binItemId: null,
			color: 'blue',
		}],
		tracks: [{
			type: 'video',
			id: 'track-1',
			name: 'Video',
			clipIds: ['clip-1'],
			mute: false,
			hidden: false,
			collapsed: false,
			height: 120,
			laneGroupId: null,
		}],
	};
}

function composition(changes = {}) {
	return {
		...structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION),
		...changes,
		crop: {
			...DEFAULT_VIDEO_CLIP_COMPOSITION.crop,
			...(changes.crop || {}),
		},
		transform: {
			...DEFAULT_VIDEO_CLIP_COMPOSITION.transform,
			...(changes.transform || {}),
		},
	};
}
