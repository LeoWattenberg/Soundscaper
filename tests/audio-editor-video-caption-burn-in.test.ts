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
	// Each cue's window is its own; the commas inside are escaped for the graph
	// parser, which would otherwise read them as filter separators.
	assert.ok(chain.includes(String.raw`enable='between(t\,0.1\,0.4)'`));
	assert.ok(chain.includes(String.raw`enable='between(t\,0.5\,0.9)'`));
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
			burnInFontPath: '/font.woff',
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
	const stage = (height: number) => resolveVideoBurnInStage(
		[{ startFrame: 0, endFrame: SR, title: 'cue' }],
		{ height },
		SR,
	)!;

	// Ten per cent of height is the title-safe band text has always sat inside.
	assert.deepEqual(
		{ ...stage(1_080) },
		{
			fontSizePx: 49,
			bottomMarginPx: 108,
			boxBorderPx: 12,
			lineSpacingPx: 12,
			cues: [{ index: 0, startSeconds: 0, endSeconds: 1, text: 'cue' }],
		},
	);
	assert.equal(stage(1_920).fontSizePx, 86, 'a 9:16 delivery gets its own height, not the width\'s');
	assert.equal(stage(120).fontSizePx, 12, 'below the floor the glyphs stop being glyphs');
});

test('a blank label is dropped rather than drawn as a bare box', () => {
	const stage = resolveVideoBurnInStage(
		[
			{ startFrame: 0, endFrame: SR, title: '   ' },
			{ startFrame: SR, endFrame: SR * 2, title: 'real' },
		],
		{ height: 720 },
		SR,
	);

	assert.deepEqual(stage?.cues.map((cue) => cue.text), ['real']);
	assert.equal(
		resolveVideoBurnInStage([{ startFrame: 0, endFrame: SR, title: '' }], { height: 720 }, SR),
		null,
		'nothing to draw means no stage at all',
	);
});

test('a burn-in past its bounds is refused with the bound rather than emitted', () => {
	const many = Array.from({ length: VIDEO_BURN_IN_MAXIMUM_CUES + 1 }, (_, index) => ({
		startFrame: index, endFrame: index + 1, title: `cue ${index}`,
	}));
	assert.throws(() => resolveVideoBurnInStage(many, { height: 720 }, SR), /at most 2000 cues/u);
	assert.throws(
		() => resolveVideoBurnInStage(
			[{ startFrame: 0, endFrame: 1, title: 'x'.repeat(VIDEO_BURN_IN_MAXIMUM_TEXT_LENGTH + 1) }],
			{ height: 720 },
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
				burnIn: { ...stage, cues: [{ index: 0, startSeconds: 1, endSeconds: 0, text: 'x' }] },
			},
		}),
		/burn-in cue ends before it starts/u,
	);
	assert.throws(
		() => assertNativeMediaGraphPlan({
			...plan,
			filterPlan: {
				...filterPlan,
				burnIn: { ...stage, cues: [{ index: 0, startSeconds: 0, endSeconds: 1, text: '' }] },
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
		burnInFontPath: '/font.woff',
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
