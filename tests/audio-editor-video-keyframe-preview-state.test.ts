/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { createVideoKeyframeRenderStateProvider } from '../src/common/editor/video-keyframe-render-state-provider.ts';
import { resolveVideoExportCanvas } from '../src/common/editor/video-export.js';
import {
	isVideoKeyframePreviewFailureCurrent,
	isVideoKeyframePreviewStateError,
	resolveVideoKeyframePreviewState,
	videoKeyframeLocalSequencePositionAtTimelineSample,
} from '../src/common/editor/video-keyframe-preview-state.ts';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';

const rational = (num: number, den = 1) => ({ num, den });

function clip(changes: Readonly<Record<string, unknown>> = {}) {
	return {
		kind: 'video',
		id: 'clip',
		timelineStartFrame: 100,
		durationFrames: 1_000,
		sequenceFrameCount: 24,
		videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		videoEffects: [],
		videoKeyframes: {
			schemaVersion: 1,
			timeDomain: {
				authoredDuration: rational(24),
				viewStart: rational(0),
				viewDuration: rational(24),
			},
			curves: [{
				target: { kind: 'composition', parameterId: 'opacity' },
				curve: {
					anchors: [
						{ position: rational(0), value: 0 },
						{ position: rational(24), value: 1 },
					],
					segments: [{ kind: 'linear' }],
				},
			}],
		},
		...changes,
	};
}

test('preview maps the exact projected sample position into visible-local sequence frames', () => {
	assert.deepEqual(videoKeyframeLocalSequencePositionAtTimelineSample(
		clip(), 350,
	), rational(6));
	assert.deepEqual(videoKeyframeLocalSequencePositionAtTimelineSample({
		...clip(),
		timelineStartFrame: 0,
		durationFrames: 1_000_000_000,
		sequenceFrameCount: 1_000_000_000,
	}, 1_000_000_000), rational(1_000_000_000));
	assert.deepEqual(videoKeyframeLocalSequencePositionAtTimelineSample({
		...clip(),
		timelineStartFrame: 0,
		durationFrames: 1_001,
		sequenceFrameCount: 30,
	}, 1), rational(30, 1_001));
});

test('preview local mapping admits both endpoints and rejects off-clip or inexact samples', () => {
	assert.deepEqual(
		videoKeyframeLocalSequencePositionAtTimelineSample(clip(), 100),
		rational(0),
	);
	assert.deepEqual(
		videoKeyframeLocalSequencePositionAtTimelineSample(clip(), 1_100),
		rational(24),
	);
	assert.throws(
		() => videoKeyframeLocalSequencePositionAtTimelineSample(clip(), 99),
		/outside.*clip|range/iu,
	);
	assert.throws(
		() => videoKeyframeLocalSequencePositionAtTimelineSample(clip(), 100.5),
		/safe integer/iu,
	);
});

test('a keyed preview resolves composition and transition opacity at the exact playhead', () => {
	const state = resolveVideoKeyframePreviewState(
		createVideoKeyframeRenderStateProvider(),
		{
			clip: clip(),
			timelineSample: 350,
			sourceDisplaySize: { width: 320, height: 180 },
			canvas: { width: 640, height: 360 },
			transitionWeight: 0.5,
		},
	);
	assert.ok(state);
	assert.equal(state.composition.opacity, 0.25);
	assert.equal(state.renderDescription.opacityStart, 0.125);
	assert.equal(state.renderDescription.opacityEnd, 0.125);
});

test('legacy clips bypass the provider without requiring keyframe-only timing fields', () => {
	const legacy = {
		kind: 'video',
		id: 'legacy',
		videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
	};
	assert.equal(resolveVideoKeyframePreviewState(
		createVideoKeyframeRenderStateProvider(),
		{
			clip: legacy,
			timelineSample: 0,
			sourceDisplaySize: { width: 1, height: 1 },
			canvas: { width: 1, height: 1 },
		},
	), null);
});

test('invalid keyed state is branded for a visible fail-closed preview without invoking accessors', () => {
	let getterCalls = 0;
	const hostile = clip();
	Object.defineProperty(hostile, 'videoKeyframes', {
		enumerable: true,
		get() {
			getterCalls += 1;
			return null;
		},
	});
	assert.throws(() => resolveVideoKeyframePreviewState(
		createVideoKeyframeRenderStateProvider(),
		{
			clip: hostile,
			timelineSample: 100,
			sourceDisplaySize: { width: 1, height: 1 },
			canvas: { width: 1, height: 1 },
		},
	), (error: unknown) => isVideoKeyframePreviewStateError(error));
	assert.equal(getterCalls, 0);

	assert.throws(() => resolveVideoKeyframePreviewState(null, {
		clip: clip(),
		timelineSample: 100,
		sourceDisplaySize: { width: 1, height: 1 },
		canvas: { width: 1, height: 1 },
	}), (error: unknown) => isVideoKeyframePreviewStateError(error));
});

test('preview failures are snapshot-scoped and the visible warning has both bundled locales', () => {
	const failedSnapshot = {};
	assert.equal(isVideoKeyframePreviewFailureCurrent(failedSnapshot, failedSnapshot), true);
	assert.equal(isVideoKeyframePreviewFailureCurrent(failedSnapshot, {}), false);
	assert.equal(isVideoKeyframePreviewFailureCurrent(null, failedSnapshot), false);
	assert.match(ENGLISH_COPY.videoPreviewKeyframesUnavailable, /invalid.*program preview.*hidden/iu);
	assert.match(GERMAN_COPY.videoPreviewKeyframesUnavailable, /ungültig.*Programmvorschau.*ausgeblendet/iu);
});

test('the preview resolves against the whole canvas record the export resolver returns', () => {
	// The panel hands down `resolveVideoExportCanvas(project)`, which states
	// eleven fields, and the provider reads a canvas as a closed record of three.
	// Every keyframed clip therefore failed closed and the preview drew nothing,
	// while the export — which narrows the canvas itself — delivered the picture.
	const canvas = resolveVideoExportCanvas(previewProject());
	assert.ok(Object.keys(canvas).length > 3, 'the export resolver states more than a render canvas needs');

	const state = resolveVideoKeyframePreviewState(createVideoKeyframeRenderStateProvider(), {
		clip: clip(),
		timelineSample: 350,
		sourceDisplaySize: { width: 320, height: 180 },
		canvas,
	});

	assert.ok(state, 'a keyframed clip previews against the canvas the panel actually resolves');
	// And the fit still reaches the placement: a cover delivery is not letterboxed.
	const covered = resolveVideoKeyframePreviewState(createVideoKeyframeRenderStateProvider(), {
		clip: clip(),
		timelineSample: 350,
		sourceDisplaySize: { width: 1_920, height: 1_080 },
		canvas: { ...canvas, width: 1_080, height: 1_920, fit: 'cover' },
	});
	assert.equal(covered!.renderDescription.sourceDisplayToCanvas[0] > 1, true, 'cover fills, not letterboxes');
});

function previewProject() {
	return {
		sampleRate: 1_000,
		selection: { startFrame: 0, endFrame: 0 },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [{
			kind: 'video', id: 'source-1', name: 'Source', mimeType: 'video/mp4',
			storageKey: 'media/source-1', frameCount: 10_000, sampleRate: 1_000,
			width: 1_920, height: 1_080, frameRate: 30, videoCodec: 'h264', audioCodec: 'aac',
			hasAudio: false, posterStorageKey: null, thumbnailStorageKey: null,
		}],
		clips: [{
			kind: 'video', id: 'clip-1', sourceId: 'source-1', title: 'Clip',
			timelineStartFrame: 0, sourceStartFrame: 0,
			sourceDurationFrames: 10_000, durationFrames: 10_000,
		}],
		tracks: [{ id: 'track-1', type: 'video', clipIds: ['clip-1'] }],
	};
}
