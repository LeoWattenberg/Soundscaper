/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	normalizeClipForProject,
	normalizeSourceForProject,
	normalizeTrackForProject,
} from '../src/common/editor/commands/shared-runtime.js';
import {
	createVideoSource,
} from '../src/common/editor/project-media-factory.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';

const VIDEO_SOURCE = createVideoSource({
	id: 'video-source',
	name: 'Video',
	storageKey: 'video',
	sampleFrameCount: 480_000,
	sampleRate: 48_000,
	width: 1_920,
	height: 1_080,
	frameRate: { num: 30, den: 1 },
	sourceFrameCount: 300,
	videoCodec: 'h264',
	timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 30, den: 1 } },
});

const PROJECT = {
	schemaVersion: 17,
	sampleRate: 48_000,
	primarySequenceId: 'sequence',
	sequences: [{ id: 'sequence', rate: { num: 30, den: 1 } }],
	tempoMap: {
		mode: 'musical',
		events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
	},
	sources: [VIDEO_SOURCE],
	tracks: [],
	clips: [],
	projectBin: { clips: [] },
	timelineAnnotations: [],
} as const;

test('current command normalization uses neutral leaf factories and current lock defaults', () => {
	const source = normalizeSourceForProject(PROJECT, VIDEO_SOURCE);
	assert.equal(source.sampleFrameCount, 480_000);
	assert.equal(source.frameCount, 480_000);
	assert.deepEqual(source.frameRate, { num: 30, den: 1 });

	const track = normalizeTrackForProject(PROJECT, { type: 'video', id: 'video-track' });
	assert.equal(track.type, 'video');
	assert.equal(track.locked, false);
	assert.throws(
		() => normalizeTrackForProject(PROJECT, { type: 'video', id: 'invalid-track', locked: 'no' }),
		/track lock.*boolean/iu,
	);

	const clip = normalizeClipForProject(PROJECT, {
		kind: 'video',
		id: 'video-clip',
		sourceId: 'video-source',
		sequenceId: 'sequence',
		sequenceStartFrame: 30,
		sequenceFrameCount: 60,
		sourceInFrame: 15,
		sourceFrameCount: 30,
	});
	assert.equal(clip.coordinateDomain, 'resolved-samples');
	assert.deepEqual(
		{
			timelineStartFrame: clip.timelineStartFrame,
			timelineEndFrame: clip.timelineEndFrame,
			durationFrames: clip.durationFrames,
			sourceStartFrame: clip.sourceStartFrame,
			sourceEndFrame: clip.sourceEndFrame,
			sourceDurationFrames: clip.sourceDurationFrames,
		},
		{
			timelineStartFrame: 48_000,
			timelineEndFrame: 144_000,
			durationFrames: 96_000,
			sourceStartFrame: 15,
			sourceEndFrame: 45,
			sourceDurationFrames: 30,
		},
	);
});

test('current command normalization preserves resolved product-projection coordinates', () => {
	const projection = resolveRuntimeProjectProjection({
		...PROJECT,
		sources: [],
	});
	const clip = normalizeClipForProject(projection, {
		kind: 'video',
		id: 'projected-video-clip',
		sourceId: 'transient-source',
		coordinateDomain: 'resolved-samples',
		timelineStartFrame: 101,
		durationFrames: 23,
		sourceStartFrame: 7,
		sourceDurationFrames: 11,
	});
	assert.deepEqual(
		{
			timelineStartFrame: clip.timelineStartFrame,
			timelineEndFrame: clip.timelineEndFrame,
			sourceStartFrame: clip.sourceStartFrame,
			sourceEndFrame: clip.sourceEndFrame,
		},
		{
			timelineStartFrame: 101,
			timelineEndFrame: 124,
			sourceStartFrame: 7,
			sourceEndFrame: 18,
		},
	);
});
