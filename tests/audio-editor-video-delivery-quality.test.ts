/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import { buildVideoFfmpegArgs } from '../src/common/editor/video-ffmpeg.js';
import { CANONICAL_VIDEO_EXPORT_PLAN_VERSION } from '../src/common/editor/video-export-plan-version.ts';
import { resolveVideoDeliveryFfmpegQuality } from '../src/common/editor/video-delivery-quality.ts';
import { assertNativeMediaGraphPlan } from '../src/common/editor/native-media-graph-plan-admission.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { createVideoKeyframeExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { admitVideoKeyframeEncoderWorkload } from '../src/common/editor/video-keyframe-encoder-stream.ts';
import { createFramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';
import { FRAMESCAPER_V20_PROJECT_MODEL_PROFILE } from '../src/framescaper/editor-project-v20-profile.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

test('a delivery that states no quality still states the tier every export used', () => {
	const plan = exportPlan();

	assert.equal(plan.version, CANONICAL_VIDEO_EXPORT_PLAN_VERSION);
	assert.equal(plan.quality, 'balanced');
});

test('the plan states a tier, never the encoder settings it becomes', () => {
	const plan = exportPlan({ quality: 'high' });

	assert.equal(plan.quality, 'high');
	// The tier is the whole of it: nothing codec-specific reaches the document,
	// which is what lets another encoder replay the same delivery.
	assert.equal(JSON.stringify(plan).includes('crf'), false);
});

test('an unrecognized tier is a refusal at plan build, not an encoder default', () => {
	assert.throws(() => exportPlan({ quality: 'lossless' }), /quality must be one of draft, balanced, high/u);
	assert.throws(() => exportPlan({ quality: 18 }), /quality must be one of/u);
});

test('the balanced tier produces exactly the arguments delivery already produced', () => {
	assert.deepEqual(encoderArguments('mp4'), ['-preset', 'medium', '-crf', '23', '192k']);
	assert.deepEqual(encoderArguments('webm'), ['-crf', '31', '-deadline', 'good', '-cpu-used', '4', '160k']);
});

test('each tier reaches the encoder as that codec spells it, audio rate included', () => {
	assert.deepEqual(encoderArguments('mp4', 'draft'), ['-preset', 'veryfast', '-crf', '28', '128k']);
	assert.deepEqual(encoderArguments('mp4', 'high'), ['-preset', 'slow', '-crf', '18', '256k']);
	assert.deepEqual(
		encoderArguments('webm', 'draft'),
		['-crf', '36', '-deadline', 'good', '-cpu-used', '6', '96k'],
	);
	assert.deepEqual(
		encoderArguments('webm', 'high'),
		['-crf', '24', '-deadline', 'good', '-cpu-used', '2', '192k'],
	);
});

test('a canonical plan missing its tier is refused rather than read as balanced', () => {
	const plan = exportPlan() as Record<string, unknown>;
	const { quality, ...withoutQuality } = plan;

	assert.equal(quality, 'balanced');
	assert.throws(
		() => buildVideoFfmpegArgs(withoutQuality, stagedInputs(), '/out.mp4'),
		/plan\.quality is required from version/u,
	);
});

test('a version that predates the tier cannot state one', () => {
	const plan = exportPlan();
	const canvas = plan.canvas as Record<string, unknown>;
	const { fit, ...withoutFit } = canvas;

	assert.equal(fit, 'contain');
	assert.throws(
		() => buildVideoFfmpegArgs({ ...plan, version: 6, canvas: withoutFit }, stagedInputs(), '/out.mp4'),
		/version 6 cannot state a delivery quality/u,
	);
});

test('a tampered tier is refused by the adapter and by native admission alike', () => {
	assert.throws(
		() => buildVideoFfmpegArgs({ ...exportPlan(), quality: 'insane' }, stagedInputs(), '/out.mp4'),
		/Unsupported plan\.quality: insane/u,
	);
	assert.throws(
		() => assertNativeMediaGraphPlan(JSON.parse(JSON.stringify({ ...exportPlan(), quality: 'insane' }))),
		/unsupported delivery quality/u,
	);
});

test('the canonical plan a build produces is admitted by the native contract unchanged', () => {
	assertNativeMediaGraphPlan(JSON.parse(JSON.stringify(exportPlan({ quality: 'high' }))));
});

test('the keyed encoder reads the same tiers as the composed graph', () => {
	assert.deepEqual(keyedEncoderArguments(), ['-crf', '31', '-deadline', 'good', '-cpu-used', '4']);
	assert.deepEqual(keyedEncoderArguments('draft'), ['-crf', '36', '-deadline', 'good', '-cpu-used', '6']);
	assert.deepEqual(keyedEncoderArguments('high'), ['-crf', '24', '-deadline', 'good', '-cpu-used', '2']);
});

test('an unrecognized keyed tier is refused before any frame is encoded', () => {
	assert.throws(() => keyedEncoderArguments('archival'), /must be one of draft, balanced, high/u);
});

test('a format with no mapping is a refusal rather than a silent balanced encode', () => {
	assert.throws(() => resolveVideoDeliveryFfmpegQuality('mkv', 'balanced'), /No delivery quality mapping/u);
});

function exportPlan(options: Readonly<Record<string, unknown>> = {}) {
	return createVideoExportPlan(project(), {
		range: { startFrame: 0, endFrame: 1_000 },
		...options,
	}) as Record<string, unknown>;
}

function stagedInputs() {
	return {
		videoInputPaths: new Map([['source-1', '/in.mp4']]),
		audioInputPath: '/mix.wav',
	};
}

/** The encoder knobs a tier actually reaches FFmpeg with, in argument order. */
function encoderArguments(format: string, quality?: string) {
	const plan = exportPlan({ format, ...(quality === undefined ? {} : { quality }) });
	const args = buildVideoFfmpegArgs(plan, stagedInputs(), `/out.${format}`) as string[];
	return knobs(args);
}

function keyedEncoderArguments(quality?: string) {
	const project_ = createFramescaperProjectV20(FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, framescaperV20Options());
	const compatible = structuredClone(project_) as Record<string, unknown>;
	compatible.schemaVersion = 17;
	const frameSource = createVideoKeyframeExportFrameSource({
		project: resolveRuntimeProjectProjection(compatible),
		canvas: { width: 40, height: 40, frameRate: 3 },
		startFrame: 0,
		endFrame: 48_000,
	});
	const workload = admitVideoKeyframeEncoderWorkload({
		frameSource,
		format: 'webm',
		...(quality === undefined ? {} : { quality }),
		inputPath: '/frames.rgba',
		outputPath: '/encoded.webm',
	} as never);
	return knobs(workload.ffmpegArguments as string[]);
}

function knobs(args: readonly string[]) {
	const captured: string[] = [];
	for (const [index, argument] of args.entries()) {
		if (['-preset', '-crf', '-deadline', '-cpu-used'].includes(argument)) {
			captured.push(argument, args[index + 1]!);
		}
		if (argument === '-b:a') captured.push(args[index + 1]!);
	}
	return captured;
}

function project() {
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
			width: 1_920,
			height: 1_080,
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
		}],
		tracks: [{ id: 'track-1', type: 'video', clipIds: ['clip-1'] }],
	};
}
