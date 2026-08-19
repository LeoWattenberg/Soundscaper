/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import { buildVideoFfmpegArgs } from '../src/common/editor/video-ffmpeg.js';
import { resolveVideoCaptionCues } from '../src/common/editor/video-caption-cues.ts';
import { assertNativeMediaGraphPlan } from '../src/common/editor/native-media-graph-plan-admission.ts';
import { inventoryVideoDeliveryConversions } from '../src/common/editor/delivery-video-conversion-inventory.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';

const SR = 1_000;

test('a delivery that names no caption track carries none, exactly as before', () => {
	const plan = exportPlan();

	assert.equal(plan.captions, null);
	assert.equal(plan.inputs.some((input) => input.kind === 'staged-captions'), false);
	// `-sn` is what discards a subtitle stream, so a caption-free delivery must
	// keep emitting it or its command has changed for no reason.
	assert.ok(args(plan).includes('-sn'));
});

test('a caption delivery maps its own subtitle stream and stops discarding subtitles', () => {
	const plan = exportPlan({ captions: { trackId: 'labels-1' } });
	const command = args(plan);

	assert.equal(plan.captions.subtitleCodec, 'mov_text');
	assert.equal(plan.captions.cueCount, 2);
	assert.equal(command.includes('-sn'), false, 'it would discard the stream just mapped');
	assert.ok(command.includes('-dn'), 'data streams are still dropped: captions are not data');
	assert.deepEqual(command.slice(command.indexOf('-map', command.indexOf('[audio_out]')), command.indexOf('-map_metadata')), ['-map', '1:s:0']);
	assert.deepEqual(command.slice(command.indexOf('-c:s'), command.indexOf('-c:s') + 2), ['-c:s', 'mov_text']);
});

test('each container carries captions as that container spells them', () => {
	assert.equal(exportPlan({ captions: { trackId: 'labels-1' } }).captions.subtitleCodec, 'mov_text');
	assert.equal(
		exportPlan({ format: 'webm', captions: { trackId: 'labels-1' } }).captions.subtitleCodec,
		'webvtt',
	);
});

test('the caption input is staged before the mix, so the mix is still the final input', () => {
	const plan = exportPlan({ captions: { trackId: 'labels-1' } });

	assert.deepEqual(
		plan.inputs.map((input) => input.kind),
		['video-source', 'staged-captions', 'staged-audio-mix'],
	);
	assert.doesNotThrow(() => args(plan), 'the adapter still admits the input order');
});

test('cues are clipped to the delivered range and rebased onto it', () => {
	const cues = resolveVideoCaptionCues(project(), { trackId: 'labels-1', startFrame: 200, endFrame: 800 });

	assert.deepEqual(cues.map((cue) => [cue.startFrame, cue.endFrame, cue.title]), [
		[0, 200, 'first cue'],
		[300, 600, 'second cue'],
	]);
});

test('an unusable caption request is a typed refusal at plan build', () => {
	assert.throws(() => exportPlan({ captions: { trackId: 'missing' } }), /No track missing/u);
	assert.throws(() => exportPlan({ captions: { trackId: 'track-1' } }), /is not a label track/u);
	assert.throws(() => exportPlan({ captions: {} }), /must name a label track/u);
	assert.throws(
		() => exportPlan({ captions: { trackId: 'labels-1', mux: false } }),
		/burned in, muxed, delivered as a sidecar, or some combination/u,
	);
	assert.throws(
		() => exportPlan({ captions: { trackId: 'labels-1', sidecar: 'ass' } }),
		/captions\.sidecar must be null or one of srt, vtt/u,
	);
	assert.throws(() => exportPlan({ captions: { trackId: 'labels-1', style: 'bold' } }), /Unsupported captions option/u);
});

test('a plan whose caption input and decision disagree is refused by the adapter', () => {
	const plan = exportPlan({ captions: { trackId: 'labels-1' } }) as Record<string, unknown>;

	assert.throws(
		() => buildVideoFfmpegArgs({ ...plan, captions: null }, stagedInputs(), '/out.mp4'),
		/stages captions it never asks to carry/u,
	);
	const withoutInput = {
		...plan,
		inputs: (plan.inputs as Record<string, unknown>[])
			.filter((input) => input.kind !== 'staged-captions')
			.map((input, inputIndex) => ({ ...input, inputIndex })),
	};
	assert.throws(
		() => buildVideoFfmpegArgs(withoutInput, stagedInputs(), '/out.mp4'),
		/caption input and mux decision do not agree/u,
	);
});

test('native admission accepts a caption-carrying plan and refuses an incoherent one', () => {
	assertNativeMediaGraphPlan(detached(exportPlan({ captions: { trackId: 'labels-1', sidecar: 'vtt' } })));
	assertNativeMediaGraphPlan(detached(exportPlan()));

	const plan = detached(exportPlan({ captions: { trackId: 'labels-1' } })) as Record<string, unknown>;
	assert.throws(
		() => assertNativeMediaGraphPlan({
			...plan,
			captions: { ...(plan.captions as object), mux: false, subtitleCodec: null, sidecarFormat: null },
		}),
		/captions it delivers nowhere/u,
	);
	assert.throws(
		() => assertNativeMediaGraphPlan({
			...plan,
			captions: { ...(plan.captions as object), sidecarFormat: 'ass' },
		}),
		/unsupported caption sidecar format/u,
	);
});

test('the report says what happened to the captions, including when there are none', () => {
	const muxed = codes(exportPlan({ captions: { trackId: 'labels-1', sidecar: 'srt' } }));
	assert.ok(muxed.includes('delivery.captions-muxed'));
	assert.ok(muxed.includes('delivery.captions-sidecar'));

	const none = inventoryVideoDeliveryConversions(exportPlan());
	const omission = none.find(({ code }) => code === 'delivery.captions-omitted');
	assert.equal(omission?.data.containerCanCarry, true, 'this container could have carried them');
	// A caption-carrying delivery no longer strips subtitles, and the standing
	// omission must stop claiming that it does.
	assert.equal(
		none.find(({ code }) => code === 'delivery.streams-stripped')?.data.streams,
		'subtitle, data',
	);
	assert.equal(
		inventoryVideoDeliveryConversions(exportPlan({ captions: { trackId: 'labels-1' } }))
			.find(({ code }) => code === 'delivery.streams-stripped')?.data.streams,
		'data',
	);
});

test('the dialog asks one question and the request carries both plan decisions', () => {
	const dialog = {
		mode: 'mix', range: 'project', format: 'video-mp4',
		canvasWidth: '', canvasHeight: '', canvasFit: 'contain',
		canvasFrameRate: '', canvasBackgroundColor: '',
		videoQuality: 'balanced', videoAudioLayout: 'preserve',
		captionTrackId: '', captionDelivery: 'mux',
	};
	const request = (patch: Record<string, unknown>) => (
		createExportDialogRequest({ ...dialog, ...patch }, { metadata: {} }) as Record<string, unknown>
	);

	assert.equal(Object.hasOwn(request({}), 'captions'), false, 'no track named means no captions');
	assert.deepEqual(request({ captionTrackId: 'labels-1' }).captions, {
		trackId: 'labels-1', mux: true, sidecar: null, burnIn: false,
	});
	assert.deepEqual(request({ captionTrackId: 'labels-1', captionDelivery: 'vtt' }).captions, {
		trackId: 'labels-1', mux: false, sidecar: 'vtt', burnIn: false,
	});
	assert.deepEqual(request({ captionTrackId: 'labels-1', captionDelivery: 'mux+srt' }).captions, {
		trackId: 'labels-1', mux: true, sidecar: 'srt', burnIn: false,
	});
	// Burn-in is orthogonal to where the cue document goes, so it is its own
	// control rather than five more entries in the delivery list.
	assert.deepEqual(
		request({ captionTrackId: 'labels-1', captionDelivery: 'vtt', captionBurnIn: true }).captions,
		{ trackId: 'labels-1', mux: false, sidecar: 'vtt', burnIn: true },
	);
});

test('a caption track with nothing in the delivered range is refused at plan build', () => {
	// The plan used to admit this and stage a zero-byte SubRip document, which the
	// shipped FFmpeg refuses to open at all: the delivery died in the encoder with
	// a message that never mentioned captions, and the operator was told their
	// export failed rather than that the track they picked was empty here.
	const empty = { id: 'labels-empty', type: 'label' as const, name: 'Empty', labels: [] };
	const withEmptyTrack = () => {
		const value = project();
		value.tracks.push(empty as never);
		return value;
	};

	assert.throws(
		() => createVideoExportPlan(withEmptyTrack(), {
			range: { startFrame: 0, endFrame: 1_000 },
			captions: { trackId: 'labels-empty' },
		}),
		/labels-empty.*no captions|no captions.*labels-empty/iu,
	);
	// Every delivery mode refuses, because none of them can deliver a cue that
	// does not exist — a sidecar would be an empty file and a burn-in a no-op.
	for (const captions of [
		{ trackId: 'labels-empty', mux: false, sidecar: 'srt' },
		{ trackId: 'labels-empty', mux: false, burnIn: true },
	]) {
		assert.throws(
			() => createVideoExportPlan(withEmptyTrack(), { range: { startFrame: 0, endFrame: 1_000 }, captions }),
			/no captions/iu,
			`${JSON.stringify(captions)} must be refused too`,
		);
	}
	// A populated track whose labels all fall outside this range is the same case.
	assert.throws(
		() => createVideoExportPlan(project(), {
			range: { startFrame: 1_200, endFrame: 4_000 },
			captions: { trackId: 'labels-1' },
		}),
		/no captions/iu,
	);
	// And the range that does contain cues still builds.
	assert.equal(exportPlan({ captions: { trackId: 'labels-1' } }).captions.cueCount, 2);
});

function exportPlan(options: Readonly<Record<string, unknown>> = {}) {
	return createVideoExportPlan(project(), {
		range: { startFrame: 0, endFrame: 1_000 },
		...options,
	}) as Record<string, never> & { inputs: Record<string, unknown>[]; captions: Record<string, unknown> };
}

function stagedInputs() {
	return {
		videoInputPaths: new Map([['source-1', '/in.mp4']]),
		audioInputPath: '/mix.wav',
		captionInputPath: '/cues.srt',
	};
}

function args(plan: unknown) {
	return buildVideoFfmpegArgs(plan, stagedInputs(), '/out.mp4') as string[];
}

function codes(plan: unknown) {
	return inventoryVideoDeliveryConversions(plan as never).map(({ code }) => code);
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
					{ id: 'l3', startFrame: 5_000, endFrame: 5_200, title: 'past the range' },
				],
			},
		],
	};
}
