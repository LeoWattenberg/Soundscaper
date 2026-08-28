/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import { buildVideoFfmpegArgs } from '../src/common/editor/video-ffmpeg.js';
import { resolveVideoCanvasPlacement } from '../src/common/editor/video-canvas-fit.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { createVideoKeyframeExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { admitVideoKeyframeEncoderWorkload } from '../src/common/editor/video-keyframe-encoder-stream.ts';
import { createFramescaperProjectRetime } from '../src/framescaper/editor-project-retime.ts';
import { FRAMESCAPER_RETIME_PROJECT_MODEL_PROFILE } from '../src/framescaper/editor-project-retime-profile.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import {
	VIDEO_DELIVERY_GRAPH_GOLDENS,
	VIDEO_DELIVERY_KEYED_ARGUMENTS,
	VIDEO_DELIVERY_VERTICAL_PLACEMENTS,
} from './fixtures/video-delivery-goldens.ts';

const DELIVERIES = Object.freeze({
	defaultMp4: { format: 'mp4' },
	defaultWebm: { format: 'webm' },
	verticalContain: { format: 'mp4', canvas: { size: { width: 1_080, height: 1_920 } } },
	verticalCover: { format: 'mp4', canvas: { size: { width: 1_080, height: 1_920 }, fit: 'cover' } },
	verticalStretch: { format: 'mp4', canvas: { size: { width: 1_080, height: 1_920 }, fit: 'stretch' } },
} as const);

test('a default-option delivery produces the exact command it has always produced', () => {
	for (const name of ['defaultMp4', 'defaultWebm'] as const) {
		assert.deepEqual(commandFor(name), VIDEO_DELIVERY_GRAPH_GOLDENS[name], name);
	}
});

test('each 9:16 fit crops, letterboxes, or stretches exactly as its golden says', () => {
	for (const name of ['verticalContain', 'verticalCover', 'verticalStretch'] as const) {
		assert.deepEqual(commandFor(name), VIDEO_DELIVERY_GRAPH_GOLDENS[name], name);
	}
});

test('the placement both paths share is the placement the goldens were cut from', () => {
	for (const [fit, placement] of Object.entries(VIDEO_DELIVERY_VERTICAL_PLACEMENTS)) {
		assert.deepEqual(
			{ ...resolveVideoCanvasPlacement(fit as 'contain', 1_080, 1_920, 1_920, 1_080) },
			{ ...placement },
			fit,
		);
	}
	// Cover is the one that overhangs, which is why it cannot be a pad.
	assert.ok(VIDEO_DELIVERY_VERTICAL_PLACEMENTS.cover.fittedX < 0);
});

test('the keyed path encodes finished frames with the command it has always used', () => {
	for (const [name, format, size] of [
		['defaultMp4', 'mp4', { width: 1_280, height: 720 }],
		['defaultWebm', 'webm', { width: 1_280, height: 720 }],
		['mp4', 'mp4', { width: 1_080, height: 1_920 }],
		['webm', 'webm', { width: 1_080, height: 1_920 }],
	] as const) {
		assert.deepEqual(
			keyedArguments(format, size),
			[...VIDEO_DELIVERY_KEYED_ARGUMENTS[name]!],
			name,
		);
	}
});

function commandFor(name: keyof typeof DELIVERIES) {
	const plan = createVideoExportPlan(project(), {
		range: { startFrame: 0, endFrame: 48_000 },
		...DELIVERIES[name],
	}) as { extension: string };
	const args = buildVideoFfmpegArgs(
		plan,
		{ videoInputPaths: new Map([['source-1', '/in.mp4']]), audioInputPath: '/mix.wav' },
		`/out.${plan.extension}`,
	) as string[];
	const graph = args[args.indexOf('-filter_complex') + 1]!;
	return {
		argumentCount: args.length,
		sha256: createHash('sha256').update(args.join(' ')).digest('hex'),
		geometry: [...graph.matchAll(/(?:scale|pad|crop|overlay)=[^,;[\]]+/gu)].map(([match]) => match),
	};
}

function keyedArguments(
	format: 'mp4' | 'webm',
	size: Readonly<{ width: number; height: number }>,
) {
	const base = createFramescaperProjectRetime(FRAMESCAPER_RETIME_PROJECT_MODEL_PROFILE, framescaperV20Options());
	const compatible = structuredClone(base) as Record<string, unknown>;
	compatible.schemaVersion = 17;
	const frameSource = createVideoKeyframeExportFrameSource({
		project: resolveRuntimeProjectProjection(compatible),
		canvas: { ...size, frameRate: 30, fit: 'cover' },
		startFrame: 0,
		endFrame: 48_000,
	});
	const workload = admitVideoKeyframeEncoderWorkload({
		frameSource, format, inputPath: '/frames.rgba', outputPath: `/encoded.${format}`,
	} as never);
	return [...workload.ffmpegArguments];
}

function project() {
	return {
		sampleRate: 48_000,
		selection: { startFrame: 0, endFrame: 0 },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [{
			kind: 'video',
			id: 'source-1',
			name: 'Source',
			mimeType: 'video/mp4',
			storageKey: 'media/source-1',
			frameCount: 480_000,
			sampleRate: 48_000,
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
			sourceDurationFrames: 480_000,
			durationFrames: 480_000,
		}],
		tracks: [{ id: 'track-1', type: 'video', clipIds: ['clip-1'] }],
	};
}
