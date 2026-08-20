/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { VideoSourceTimingView } from '../src/common/editor/frame-canonical-slip-slide-domain.ts';
import { planFrameCanonicalSlipSlide } from '../src/common/editor/frame-canonical-slip-slide-planner.ts';
import { projectForCommand } from '../src/common/editor/project-command-projection.ts';
import {
	createVideoClip,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	createCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
} from '../src/common/editor/video-timing-asset.ts';

const SAMPLE_RATE = 48_000;
const RATE = Object.freeze({ num: 24, den: 1 });
const SOURCE_SHA256 = 'b'.repeat(64);
const PUBLICATION = createVideoTimingAssetPublication(SOURCE_SHA256, {
	timescale: 1_000,
	presentationTicks: [0n, 100n, 110n, 1_000n, 1_015n],
	finalFrameDurationTicks: 1_000n,
});
const INDEX = validateVideoTimingAssetBytes(PUBLICATION.reference, PUBLICATION.bytes);
const ALTERNATE_PUBLICATION = createVideoTimingAssetPublication(SOURCE_SHA256, {
	timescale: 1_000,
	presentationTicks: [0n, 90n, 110n, 1_000n, 1_015n],
	finalFrameDurationTicks: 1_000n,
});
const ALTERNATE_INDEX = validateVideoTimingAssetBytes(
	ALTERNATE_PUBLICATION.reference,
	ALTERNATE_PUBLICATION.bytes,
);

test('VFR slip clamp crosses a collapsed sparse gap to the nearest reappearing legal target', () => {
	const source = createVideoSource({
		id: 'video-source', sampleFrameCount: 10_000, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: RATE, sourceFrameCount: INDEX.frameCount,
		contentSha256: SOURCE_SHA256, timingAsset: PUBLICATION.reference,
		timingDecision: { mode: 'exact', rate: RATE, backend: 'fixture' },
	}, SAMPLE_RATE);
	const clip = createVideoClip({
		id: 'video', sourceId: 'video-source', sequenceId: 'main',
		sequenceStartFrame: 10, sequenceFrameCount: 4,
		sourceInFrame: 1, sourceFrameCount: 1,
	}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate: RATE }, source });
	const track = createVideoTrack({
		id: 'video-track', clipIds: ['video'], locked: false,
	});
	const persisted = createCurrentAudioEditorProject({
		id: 'vfr-gap-slip', now: '2026-08-11T18:10:00.000Z', sampleRate: SAMPLE_RATE,
		sequences: [{ id: 'main', rate: RATE, trackIds: ['video-track'] }],
		primarySequenceId: 'main', sources: [source], clips: [clip], tracks: [track],
	});
	const project = projectForCommand(persisted as unknown as Record<string, unknown>);
	const view: VideoSourceTimingView = Object.freeze({
		kind: 'vfr', reference: PUBLICATION.reference, index: INDEX,
	});
	const timingViews = Object.freeze(new Map([['video-source', view]]));

	const plan = planFrameCanonicalSlipSlide(project, timingViews, {
		mode: 'slip', activeClipId: 'video', requestedSourceInFrame: 4,
	});

	assert.equal(plan.kind, 'transform');
	assert.equal(plan.requestedSourceInFrame, 4);
	assert.equal(plan.appliedSourceInFrame, 3);
	assert.equal(plan.sourceFrameDelta, 2);
	assert.equal(plan.clamped, true);
	assert.deepEqual(plan.sourceRanges, [
		{ clipId: 'video', sourceStartFrame: 3, sourceEndFrame: 4 },
	]);
	assert.deepEqual(plan.transforms, [{
		clipId: 'video', trackId: 'video-track', changes: { sourceStartFrame: 3 },
	}]);
	assert.deepEqual([
		plan.previews[0]?.sourceStartFrame,
		plan.previews[0]?.sourceDurationFrames,
	], [3, 1]);

	const substituted = Object.freeze(new Map([['video-source', Object.freeze({
		kind: 'vfr' as const,
		reference: PUBLICATION.reference,
		index: ALTERNATE_INDEX,
	})]]));
	assert.throws(() => planFrameCanonicalSlipSlide(project, substituted, {
		mode: 'slip', activeClipId: 'video', requestedSourceInFrame: 4,
	}), /identity|reference|timing|verified/iu);
});
