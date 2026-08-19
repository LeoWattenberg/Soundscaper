/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import { buildVideoFfmpegArgs } from '../src/common/editor/video-ffmpeg.js';
import {
	resolveVideoBurnInStage,
	VIDEO_BURN_IN_MAXIMUM_CUES,
	VIDEO_BURN_IN_MAXIMUM_TEXT_LENGTH,
} from '../src/common/editor/video-caption-burn-in.ts';
import { assertNativeMediaGraphPlan } from '../src/common/editor/native-media-graph-plan-admission.ts';
import { inventoryVideoDeliveryConversions } from '../src/common/editor/delivery-video-conversion-inventory.ts';
import { VIDEO_DELIVERY_BURN_IN_GOLDENS } from './fixtures/video-delivery-goldens.ts';

const SR = 1_000;

test('a delivery that burns nothing in carries no burn-in stage at all', () => {
	const plan = exportPlan();

	assert.equal(plan.filterPlan.burnIn, null);
	assert.equal(graph(plan).includes('drawtext'), false);
	assert.ok(graph(plan).includes('concat=n=1:v=1:a=0[video_out]'), 'the composited picture is the output');
});

test('a burned delivery draws each cue over the composited picture, in its own window', () => {
	const plan = exportPlan({ captions: { trackId: 'labels-1', mux: false, burnIn: true } });
	const chain = graph(plan).split(';').find((segment) => segment.includes('drawtext='))!;

	assert.ok(chain.startsWith('[video_composited]drawtext='), 'burn-in follows the composite, not each clip');
	assert.ok(chain.endsWith('[video_out]'));
	assert.equal(chain.split('drawtext=').length - 1, 2, 'one drawtext per cue');
	// Each cue's window is its own, and half-open so that contiguous cues never
	// share the frame they touch. The commas inside are escaped for the graph
	// parser, which would otherwise read them as filter separators.
	assert.ok(chain.includes(String.raw`enable='gte(t\,0.1)*lt(t\,0.4)'`));
	assert.ok(chain.includes(String.raw`enable='gte(t\,0.5)*lt(t\,0.9)'`));
});

test('cue text is read from a staged file rather than written into the graph', () => {
	const plan = exportPlan({ captions: { trackId: 'labels-1', mux: false, burnIn: true } });
	const chain = graph(plan);

	// The escaping a caption would need to survive three layers of FFmpeg
	// parsing is a defect waiting to happen: a plain "16:9" already breaks it.
	assert.equal(chain.includes('first cue'), false);
	assert.ok(chain.includes('textfile=/cue-0.txt'));
	assert.ok(chain.includes('textfile=/cue-1.txt'));
	assert.ok(chain.includes('expansion=none'), 'a caption saying 100% is a caption, not a directive');
});

test('a burn-in with no staged text for a cue is a refusal, not a blank frame', () => {
	const plan = exportPlan({ captions: { trackId: 'labels-1', mux: false, burnIn: true } });

	assert.throws(
		() => buildVideoFfmpegArgs(plan, {
			videoInputPaths: new Map([['source-1', '/in.mp4']]),
			audioInputPath: '/mix.wav',
			burnInFontPaths: new Map([['latin', '/font.woff']]),
			burnInCueTextPaths: new Map([[0, '/cue-0.txt']]),
		}, '/out.mp4'),
		/Missing staged burn-in text for cue 1/u,
	);
});

test('the burned presentation is the golden one at 16:9 and at 9:16', () => {
	for (const [name, golden] of Object.entries(VIDEO_DELIVERY_BURN_IN_GOLDENS)) {
		const stage = resolveVideoBurnInStage(
			[{ startFrame: 0, endFrame: SR, title: 'cue' }],
			golden.canvas,
			SR,
		)!;
		assert.deepEqual(
			{
				fontSizePx: stage.fontSizePx,
				bottomMarginPx: stage.bottomMarginPx,
				boxBorderPx: stage.boxBorderPx,
				lineSpacingPx: stage.lineSpacingPx,
			},
			{
				fontSizePx: golden.fontSizePx,
				bottomMarginPx: golden.bottomMarginPx,
				boxBorderPx: golden.boxBorderPx,
				lineSpacingPx: golden.lineSpacingPx,
			},
			name,
		);
	}
});

test('the fixed presentation scales with the canvas and keeps a floor', () => {
	const stage = (width: number, height: number) => resolveVideoBurnInStage(
		[{ startFrame: 0, endFrame: SR, title: 'cue' }],
		{ width, height },
		SR,
	)!;

	// Ten per cent of height is the title-safe band text has always sat inside.
	assert.deepEqual(
		{ ...stage(1_920, 1_080) },
		{
			fontSizePx: 49,
			bottomMarginPx: 108,
			boxBorderPx: 12,
			lineSpacingPx: 12,
			cues: [{
				index: 0, startSeconds: 0, endSeconds: 1, text: 'cue',
				fontSubset: 'latin', undrawable: [],
			}],
		},
	);
	// A tall, narrow delivery answers to its width, because that is the edge its
	// captions run off; a wide one still answers to its height as it always did.
	assert.equal(stage(1_080, 1_920).fontSizePx, 55);
	assert.equal(stage(3_840, 1_920).fontSizePx, 86);
	assert.equal(stage(1_280, 120).fontSizePx, 12, 'below the floor the glyphs stop being glyphs');
});

test('a blank label is dropped rather than drawn as a bare box', () => {
	const stage = resolveVideoBurnInStage(
		[
			{ startFrame: 0, endFrame: SR, title: '   ' },
			{ startFrame: SR, endFrame: SR * 2, title: 'real' },
		],
		{ width: 1_280, height: 720 },
		SR,
	);

	assert.deepEqual(stage?.cues.map((cue) => cue.text), ['real']);
	assert.equal(
		resolveVideoBurnInStage([{ startFrame: 0, endFrame: SR, title: '' }], { width: 1_280, height: 720 }, SR),
		null,
		'nothing to draw means no stage at all',
	);
});

test('a burn-in past its bounds is refused with the bound rather than emitted', () => {
	const many = Array.from({ length: VIDEO_BURN_IN_MAXIMUM_CUES + 1 }, (_, index) => ({
		startFrame: index, endFrame: index + 1, title: `cue ${index}`,
	}));
	assert.throws(() => resolveVideoBurnInStage(many, { width: 1_280, height: 720 }, SR), /at most 2000 cues/u);
	assert.throws(
		() => resolveVideoBurnInStage(
			[{ startFrame: 0, endFrame: 1, title: 'x'.repeat(VIDEO_BURN_IN_MAXIMUM_TEXT_LENGTH + 1) }],
			{ width: 1_280, height: 720 },
			SR,
		),
		/at most 500 characters/u,
	);
});

test('burn-in alone is a complete caption delivery, and is stated as one', () => {
	const plan = exportPlan({ captions: { trackId: 'labels-1', mux: false, burnIn: true } });

	assert.equal(plan.captions.burnIn, true);
	assert.equal(plan.captions.mux, false);
	assert.equal(plan.captions.sidecarFormat, null);
	// It carries no subtitle stream, so the delivery still discards the sources'.
	assert.ok(args(plan).includes('-sn'));
});

test('native admission ties the stage to the decision that asked for it', () => {
	const burned = detached(exportPlan({ captions: { trackId: 'labels-1', mux: false, burnIn: true } }));
	assertNativeMediaGraphPlan(burned);
	assertNativeMediaGraphPlan(detached(exportPlan()));

	const plan = burned as Record<string, unknown>;
	assert.throws(
		() => assertNativeMediaGraphPlan({
			...plan,
			captions: { ...(plan.captions as object), burnIn: false, sidecarFormat: 'srt' },
		}),
		/burns in captions it never asked for/u,
	);
	const filterPlan = plan.filterPlan as Record<string, unknown>;
	const stage = filterPlan.burnIn as Record<string, unknown>;
	assert.throws(
		() => assertNativeMediaGraphPlan({
			...plan,
			filterPlan: {
				...filterPlan,
				burnIn: { ...stage, cues: [{ index: 0, startSeconds: 1, endSeconds: 0, text: 'x', fontSubset: 'latin', undrawable: [] }] },
			},
		}),
		/burn-in cue ends before it starts/u,
	);
	assert.throws(
		() => assertNativeMediaGraphPlan({
			...plan,
			filterPlan: {
				...filterPlan,
				burnIn: { ...stage, cues: [{ index: 0, startSeconds: 0, endSeconds: 1, text: '', fontSubset: 'latin', undrawable: [] }] },
			},
		}),
		/not a bounded caption line/u,
	);
});

test('the report says the picture was changed, and says when cues collide', () => {
	const burned = inventoryVideoDeliveryConversions(
		exportPlan({ captions: { trackId: 'labels-1', mux: false, burnIn: true } }) as never,
	);
	const item = burned.find(({ code }) => code === 'delivery.captions-burned');
	assert.equal(item?.severity, 'warning', 'burning in cannot be undone in the delivered picture');
	assert.equal(item?.data.cueCount, 2);
	assert.equal(burned.some(({ code }) => code === 'delivery.captions-overlapping'), false);

	const overlapping = inventoryVideoDeliveryConversions(
		exportPlan({
			captions: { trackId: 'overlapping', mux: false, burnIn: true },
		}) as never,
	);
	assert.ok(overlapping.some(({ code }) => code === 'delivery.captions-overlapping'));
});

function exportPlan(options: Readonly<Record<string, unknown>> = {}) {
	return createVideoExportPlan(project(), {
		range: { startFrame: 0, endFrame: 1_000 },
		...options,
	}) as Record<string, never> & {
		captions: Record<string, unknown>;
		filterPlan: Record<string, unknown>;
	};
}

function args(plan: unknown) {
	return buildVideoFfmpegArgs(plan, {
		videoInputPaths: new Map([['source-1', '/in.mp4']]),
		audioInputPath: '/mix.wav',
		burnInFontPaths: new Map([['latin', '/font.woff']]),
		burnInCueTextPaths: new Map([[0, '/cue-0.txt'], [1, '/cue-1.txt']]),
	}, '/out.mp4') as string[];
}

function graph(plan: unknown) {
	const command = args(plan);
	return command[command.indexOf('-filter_complex') + 1]!;
}

function detached(plan: unknown) {
	return JSON.parse(JSON.stringify(plan)) as unknown;
}

function project() {
	return {
		sampleRate: SR,
		selection: { startFrame: 0, endFrame: 0 },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [{
			kind: 'video',
			id: 'source-1',
			name: 'Source',
			mimeType: 'video/mp4',
			storageKey: 'media/source-1',
			frameCount: 10_000,
			sampleRate: SR,
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
		tracks: [
			{ id: 'track-1', type: 'video', clipIds: ['clip-1'] },
			{
				id: 'labels-1',
				type: 'label',
				name: 'Dialogue',
				labels: [
					{ id: 'l1', startFrame: 100, endFrame: 400, title: 'first cue' },
					{ id: 'l2', startFrame: 500, endFrame: 900, title: 'second cue' },
				],
			},
			{
				id: 'overlapping',
				type: 'label',
				name: 'Overlapping',
				labels: [
					{ id: 'o1', startFrame: 100, endFrame: 600, title: 'one' },
					{ id: 'o2', startFrame: 500, endFrame: 900, title: 'two' },
				],
			},
		],
	};
}

test('a burned line is sized and wrapped to fit the canvas it is drawn on', () => {
	// Measured against the shipped runtime with the staged Inter semibold: a
	// 44-character line drew 1884 px wide at fontsize 86 and 685 px at fontsize
	// 32, an advance of about half the font size per character. The type used to
	// be sized from height alone, so a 1080x1920 delivery drew at 86 px and any
	// caption past 28 characters ran off both edges of the frame.
	const line = 'Here is a caption line that a narrator might actually say out loud.';
	const cue = { startFrame: 0, endFrame: 500, title: line };
	const drawnWidth = (text: string, fontSizePx: number) => Math.max(
		...text.split('\n').map((value) => value.length * fontSizePx * 0.5),
	);

	for (const canvas of [
		{ width: 1_080, height: 1_920 },
		{ width: 720, height: 1_280 },
		{ width: 1_280, height: 720 },
		{ width: 1_920, height: 1_080 },
	]) {
		const stage = resolveVideoBurnInStage([cue], canvas, SR)!;
		assert.ok(
			drawnWidth(stage.cues[0]!.text, stage.fontSizePx) <= canvas.width,
			`${canvas.width}x${canvas.height} draws ${stage.cues[0]!.text} at ${stage.fontSizePx}px past its frame`,
		);
		assert.ok(stage.cues[0]!.text.includes('\n'), 'a line too long for the frame wraps rather than overflowing');
		for (const wrapped of stage.cues[0]!.text.split('\n')) {
			assert.ok(wrapped.length > 0, 'wrapping never emits an empty line');
			assert.equal(wrapped.trim(), wrapped, 'wrapping never leaves an edge space');
		}
	}

	// The 16:9 presentation is unchanged: those deliveries were never the ones
	// that overflowed, and their goldens still hold.
	assert.equal(resolveVideoBurnInStage([cue], { width: 1_280, height: 720 }, SR)!.fontSizePx, 32);
	assert.equal(resolveVideoBurnInStage([cue], { width: 1_920, height: 1_080 }, SR)!.fontSizePx, 49);
	// A short caption is left alone whatever the canvas.
	const short = resolveVideoBurnInStage([{ ...cue, title: 'Short line.' }], { width: 1_080, height: 1_920 }, SR)!;
	assert.equal(short.cues[0]!.text, 'Short line.');
});

test('a cue with no time on screen is not drawn, so touching cues never share a frame', () => {
	const stage = resolveVideoBurnInStage([
		{ startFrame: 0, endFrame: 0, title: 'zero length' },
		{ startFrame: 100, endFrame: 400, title: 'first' },
	], { width: 1_280, height: 720 }, SR);

	assert.deepEqual(stage!.cues.map((cue) => cue.text), ['first']);
	assert.equal(resolveVideoBurnInStage([{ startFrame: 7, endFrame: 7, title: 'only' }], { width: 1_280, height: 720 }, SR), null);
});

test('a burn-in stage that draws nothing is refused rather than admitted as empty', () => {
	const plan = exportPlan({ captions: { trackId: 'labels-1', mux: false, burnIn: true } });
	const burnIn = plan.filterPlan.burnIn as Record<string, unknown>;
	const emptied = {
		...plan,
		filterPlan: { ...plan.filterPlan, burnIn: { ...burnIn, cues: [] } },
	};

	// `null` is the one shape "nothing to draw" takes. An empty cue list is a
	// second spelling of it that no producer emits, and it builds a filter chain
	// with no filter between its labels, which the runtime refuses outright.
	assert.throws(() => assertNativeMediaGraphPlan(emptied), /draws no cues/u);
	assert.doesNotThrow(() => assertNativeMediaGraphPlan({ ...plan, filterPlan: { ...plan.filterPlan, burnIn: null } }));
});
