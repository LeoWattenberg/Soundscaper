/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { buildVideoFfmpegArgs } from '../src/common/editor/video-ffmpeg.js';
import {
	resolveVideoRenderDescription,
	type VideoRenderDescription,
} from '../src/common/editor/video-render-description.ts';
import { CANONICAL_VIDEO_EXPORT_PLAN_VERSION } from '../src/common/editor/video-export-plan-version.ts';
import type { VideoCanvasFit } from '../src/common/editor/video-canvas-fit.ts';

// A 16:9 master delivered into a 9:16 canvas, which is the case the fit exists for.
const CANVAS = Object.freeze({ width: 1_080, height: 1_920 });
const SOURCE = Object.freeze({ width: 1_920, height: 1_080 });

test('a contain delivery emits exactly the fit and pad it has always emitted', () => {
	// 1080/1920 beats 1920/1080, so the source shrinks to 1080x608 and centres
	// with 656 rows of background above and below it.
	const graph = filterGraph('contain');

	assert.match(graph, /scale=w=1080:h=608:flags=bicubic/u);
	assert.match(graph, /pad=w=1080:h=1920:x=0:y=656:color=black@0/u);
	assert.doesNotMatch(graph, /overlay=x=/u, 'a contained delivery keeps its single-filter shortcut');
});

test('a cover delivery overhangs the canvas, so it overlays where it cannot pad', () => {
	// Covering 1920 rows scales the source to 3413x1920, which overhangs the
	// canvas by 1166 columns on the left. `pad` cannot express that, so the
	// general overlay path has to take it rather than emit a negative offset.
	const graph = filterGraph('cover');

	assert.match(graph, /scale=w=3413:h=1920:flags=bicubic/u);
	assert.doesNotMatch(graph, /pad=w=1080:h=1920/u);
	assert.match(graph, /overlay=x=540\.5-overlay_w\/2:y=960-overlay_h\/2/u);
});

test('a stretch delivery fills the canvas outright and still pads nothing away', () => {
	const graph = filterGraph('stretch');

	assert.match(graph, /scale=w=1080:h=1920:flags=bicubic/u);
	assert.match(graph, /pad=w=1080:h=1920:x=0:y=0:color=black@0/u);
});

test('a plan version that cannot state a fit is refused for stating one', () => {
	const plan = canonicalPlan('cover') as Record<string, unknown>;
	plan.version = 6;

	assert.throws(() => filterGraphFor(plan), /version 6 cannot state a canvas fit/u);
});

test('a canonical plan that states no fit at all is refused rather than assumed', () => {
	const plan = canonicalPlan('contain') as Record<string, unknown>;
	delete (plan.canvas as Record<string, unknown>).fit;

	assert.throws(
		() => filterGraphFor(plan),
		new RegExp(`plan\\.canvas\\.fit is required from version ${String(CANONICAL_VIDEO_EXPORT_PLAN_VERSION)}`, 'u'),
	);
});

test('a fit outside the closed set is refused rather than falling back to contain', () => {
	const plan = canonicalPlan('contain') as Record<string, unknown>;
	(plan.canvas as Record<string, unknown>).fit = 'fill';

	assert.throws(() => filterGraphFor(plan), /Unsupported plan\.canvas\.fit: fill/u);
});

function filterGraph(fit: VideoCanvasFit): string {
	return filterGraphFor(canonicalPlan(fit));
}

function filterGraphFor(plan: Record<string, unknown>): string {
	const args = buildVideoFfmpegArgs(
		plan,
		{ videoInputPaths: { 'source-0': '/stage/source-0.mp4' } },
		'output.mp4',
	);
	return String(args[args.indexOf('-filter_complex') + 1]);
}

function canonicalPlan(fit: VideoCanvasFit): Record<string, unknown> {
	return {
		version: CANONICAL_VIDEO_EXPORT_PLAN_VERSION,
		format: 'mp4',
		container: 'mp4',
		extension: 'mp4',
		mimeType: 'video/mp4',
		durationSeconds: 1,
		canvas: { ...CANVAS, frameRate: 30, fit, pixelFormat: 'yuv420p', backgroundColor: '#000000' },
		codecs: {
			video: 'h264', videoEncoder: 'libx264', audio: null, audioEncoder: null, pixelFormat: 'yuv420p',
		},
		inputs: [{ kind: 'video-source', inputIndex: 0, sourceId: 'source-0', mimeType: 'video/mp4' }],
		intervals: [{
			kind: 'composition',
			durationSeconds: 1,
			layers: [{
				trackId: 'video',
				trackIndex: 0,
				clips: [{
					role: 'single',
					inputIndex: 0,
					sourceId: 'source-0',
					sourceStartTimeSeconds: 0,
					sourceEndTimeSeconds: 1,
					playbackRate: 1,
					opacityStart: 1,
					opacityEnd: 1,
					videoEffects: [],
					renderDescription: description(fit),
				}],
			}],
		}],
		filterPlan: { audio: { strategy: 'none' } },
	};
}

function description(fit: VideoCanvasFit): VideoRenderDescription {
	return resolveVideoRenderDescription({
		composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		sourceDisplaySize: SOURCE,
		canvas: { ...CANVAS, fit },
	});
}
