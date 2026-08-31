/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	mapVideoTimelineFrameToSource,
	mapVideoSourceFrameToTimeline,
	registerVideoTimingIndex,
	selectVideoThumbnailTimestamps,
	unregisterVideoTimingIndex,
	videoClipPlaybackRate,
} from '../src/common/editor/video-source-time.ts';
import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import {
	createVideoClip,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createVideoTimingAssetPublication } from '../src/common/editor/video-timing-asset.ts';

test('video source mapping consumes registered VFR PTS instead of nominal-rate division', () => {
	const source = {
		id: 'vfr-source',
		kind: 'video',
		contentSha256: '11'.repeat(32),
		frameRate: { num: 24, den: 1 },
	};
	const clip = {
		id: 'clip', kind: 'video', sourceId: source.id,
		timelineStartFrame: 0, durationFrames: 300,
		sourceStartFrame: 0, sourceDurationFrames: 3,
		sourceInFrame: 0, sourceFrameCount: 3,
	};
	registerVideoTimingIndex(source, {
		encoding: 'soundscaper-video-timing-v1',
		timescale: 1_000,
		frameCount: 3,
		presentationTicks: [0n, 100n, 300n],
		finalFrameDurationTicks: 200n,
		endTicks: 500n,
	});
	try {
		const mapped = mapVideoTimelineFrameToSource(clip, 150, {
			projectSampleRate: 1_000,
			sourceSampleRate: 24,
			source,
		});
		assert.equal(mapped.sourceFrame, 1.75);
		assert.equal(mapped.sourceTimeSeconds, 0.25);
		assert.deepEqual(mapVideoSourceFrameToTimeline(clip, mapped.sourceFrame, {
			projectSampleRate: 1_000,
			sourceSampleRate: 24,
			source,
		}), {
			sourceFrame: 1.75,
			sourceTimeSeconds: 0.25,
			localSourceFrame: 1.75,
			progress: 0.5,
			timelineFrame: 150,
			timelineTimeSeconds: 0.15,
		});
		assert.equal(videoClipPlaybackRate(clip, 1_000, 24, source), 5 / 3);
	} finally {
		unregisterVideoTimingIndex(source);
	}
	assert.equal(mapVideoTimelineFrameToSource(clip, 150, {
		projectSampleRate: 1_000,
		sourceSampleRate: 24,
		source,
	}).sourceTimeSeconds, 0.0625);
});

test('legacy sample-coordinate thumbnails ignore an exact frame timing index for the same source', () => {
	const source = { id: 'legacy-source', sampleRate: 1_000 };
	const clip = {
		timelineStartFrame: 0, durationFrames: 1,
		sourceStartFrame: 1, sourceDurationFrames: 1,
	};
	registerVideoTimingIndex(source, {
		timescale: 1_000, frameCount: 3, presentationTicks: [0n, 100n, 300n],
		finalFrameDurationTicks: 200n, endTicks: 500n,
	});
	try {
		assert.equal(selectVideoThumbnailTimestamps(clip, source, {
			projectSampleRate: 1_000,
		})[0]?.sourceTimeSeconds, 0.001);
	} finally {
		unregisterVideoTimingIndex(source);
	}
});

test('VFR preview mapping and export use one exact PTS span', () => {
	const sourceSha256 = '22'.repeat(32);
	const timing = createVideoTimingAssetPublication(sourceSha256, {
		timescale: 1_000,
		presentationTicks: [0n, 100n, 300n],
		finalFrameDurationTicks: 200n,
	});
	const sequence = { id: 'main', rate: { num: 10, den: 1 } };
	const source = createVideoSource({
		id: 'vfr-source', storageKey: 'vfr-source', name: 'VFR', mimeType: 'video/mp4',
		frameCount: 5_000, sampleRate: 10_000, width: 16, height: 16,
		frameRate: { num: 24, den: 1 }, sourceFrameCount: 3,
		contentSha256: sourceSha256, timingAsset: timing.reference,
		timingDecision: { mode: 'exact', rate: { num: 24, den: 1 } },
	}, 10_000);
	const clip = createVideoClip({
		id: 'clip', sourceId: source.id, sequenceId: sequence.id,
		sequenceStartFrame: 0, sequenceFrameCount: 3,
		sourceInFrame: 0, sourceFrameCount: 3,
	}, { projectSampleRate: 10_000, sequence, source });
	const project = createCurrentAudioEditorProject({
		id: 'vfr-export', sampleRate: 10_000,
		sequences: [sequence], primarySequenceId: sequence.id,
		sources: [source], clips: [clip],
		tracks: [createVideoTrack({ id: 'video', clipIds: [clip.id] })],
	});

	registerVideoTimingIndex(source, {
		encoding: 'soundscaper-video-timing-v1',
		timescale: 1_000,
		frameCount: 3,
		presentationTicks: [0n, 100n, 300n],
		finalFrameDurationTicks: 200n,
		endTicks: 500n,
	});
	try {
		const preview = mapVideoTimelineFrameToSource(
			{ ...clip, timelineStartFrame: 0, durationFrames: 3_000, sourceStartFrame: 0, sourceDurationFrames: 3 },
			1_500,
			{ projectSampleRate: 10_000, sourceSampleRate: 24, source },
		);
		const plan = createVideoExportPlan(project, {
			format: 'mp4', includeAudio: false, range: { startFrame: 0, endFrame: 3_000 },
		});
		const exported = plan.intervals[0].layers[0].clips[0];
		assert.equal(preview.sourceTimeSeconds, 0.25);
		assert.equal(exported.sourceStartTimeSeconds, 0);
		assert.equal(exported.sourceEndTimeSeconds, 0.5);
		assert.equal(exported.playbackRate, 5 / 3);
		assert.equal(plan.filterPlan.intervals[0].layers[0].clips[0].operations[1].playbackRate, 5 / 3);
	} finally {
		unregisterVideoTimingIndex(source);
	}
});
