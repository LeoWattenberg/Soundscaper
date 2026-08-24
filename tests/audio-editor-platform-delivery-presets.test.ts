/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	findPlatformDeliveryPreset,
	PLATFORM_DELIVERY_PRESETS,
	resolvePlatformDeliveryAvailability,
	resolvePlatformDeliveryExecution,
	resolvePlatformDeliveryPlanOptions,
} from '../src/common/editor/platform-delivery-presets.ts';
import { PLATFORM_DELIVERY_LICENSING_ROWS } from '../src/common/editor/platform-delivery-licensing.ts';
import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import { MEDIA_EXPORT_FORMATS } from '../src/common/editor/media-export.js';
import {
	DEFAULT_PLATFORM_IMAGE_SEQUENCE_COMPANION_AUDIO_V1,
	PLATFORM_IMAGE_SEQUENCE_COMPANION_AUDIO_FORMATS_V1,
	snapshotPlatformImageSequenceCompanionAudioChoiceV1,
} from '../src/common/editor/platform-image-sequence-companion-audio.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import { statedVideoDeliveryTarget } from '../src/common/editor/ui/export-preset-model.ts';
import { inventoryVideoDeliveryConversions } from '../src/common/editor/delivery-video-conversion-inventory.ts';

const MATRIX = JSON.parse(
	await readFile(new URL('../config/production-licensing-matrix.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

test('every catalog preset names rows the recorded matrix actually contains', () => {
	const rowIds = new Set(
		Object.values(MATRIX)
			.filter((value): value is Record<string, unknown>[] => Array.isArray(value))
			.flat()
			.map((row) => row?.id)
			.filter((id): id is string => typeof id === 'string'),
	);
	for (const preset of PLATFORM_DELIVERY_PRESETS) {
		for (const rowId of preset.licensingRowIds) {
			assert.ok(rowIds.has(rowId), `${preset.id} names an unrecorded row ${rowId}`);
		}
	}
});

test('the presets that ship deliver, and resolve to options a plan builder accepts', () => {
	const shipping = PLATFORM_DELIVERY_PRESETS.filter((preset) => preset.licensingRowIds.length === 0);
	assert.ok(shipping.length >= 3, 'a catalog with nothing deliverable is a catalog of promises');
	for (const preset of shipping) {
		const availability = resolvePlatformDeliveryAvailability(preset, MATRIX);
		assert.deepEqual({ ...availability }, {
			presetId: preset.id,
			available: true,
			status: 'shipped',
			blockingRowIds: [],
			blocker: null,
			fallbackPresetId: preset.fallbackPresetId,
		});
		const options = resolvePlatformDeliveryPlanOptions(preset, MATRIX)!;
		const plan = createVideoExportPlan(project(), {
			...options,
			range: { startFrame: 0, endFrame: 1_000 },
		}) as { format: string; canvas: Record<string, unknown> };
		assert.equal(plan.format, options.format);
	}
});

test('every gated preset is blocked today, states why, and resolves to no plan', () => {
	const gated = PLATFORM_DELIVERY_PRESETS.filter((preset) => preset.licensingRowIds.length > 0);
	assert.ok(gated.length >= 6, 'the native tier the milestone names is declared, not omitted');
	for (const preset of gated) {
		const availability = resolvePlatformDeliveryAvailability(preset, MATRIX);
		assert.equal(availability.available, false, `${preset.id} is not gated by anything`);
		assert.equal(availability.status, 'blocked', preset.id);
		assert.ok(availability.blocker && availability.blocker.length > 0, `${preset.id} blocks without saying why`);
		assert.deepEqual(
			availability.blockingRowIds,
			preset.licensingRowIds.filter((id) => availability.blockingRowIds.includes(id)),
			'blocking rows are reported in the order the preset names them',
		);
		assert.equal(resolvePlatformDeliveryPlanOptions(preset, MATRIX), null, preset.id);
	}
});

test('the catalog binds every platform target to one explicit web or V15 native execution', () => {
	const executions = Object.fromEntries(PLATFORM_DELIVERY_PRESETS.map((preset) => [
		preset.id, preset.execution,
	]));
	assert.equal(executions['web-1080p']?.kind, 'web-video-plan');
	assert.equal(executions['web-vertical-1080']?.kind, 'web-video-plan');
	assert.equal(executions['web-vp9-1080p']?.kind, 'web-video-plan');
	assert.deepEqual(
		Object.fromEntries(Object.entries(executions)
			.filter(([, execution]) => execution?.kind === 'native-media-v15')
			.map(([id, execution]) => [id, execution.profileId])),
		{
			'native-uhd-hdr10': 'encode-hevc-main10-hdr10',
			'native-10-bit-sdr': 'encode-hevc-main10-sdr',
			'native-hardware-h264': 'encode-mp4-h264',
			'native-mezzanine-prores': 'encode-mov-prores-422-hq',
			'native-alpha-mezzanine': 'encode-mov-prores-4444',
			'native-image-sequence-png': 'encode-png-sequence',
		},
	);
});

test('native execution exposes caption, hardware, and companion-audio policy without bypassing gates', () => {
	const cleared = structuredClone(MATRIX) as Record<string, unknown>;
	for (const rows of Object.values(cleared)) {
		if (!Array.isArray(rows)) continue;
		for (const row of rows) {
			if (row && typeof row === 'object') (row as Record<string, unknown>).status = 'cleared';
		}
	}
	const prores = resolvePlatformDeliveryExecution(
		findPlatformDeliveryPreset('native-mezzanine-prores')!, cleared,
	);
	assert.deepEqual(prores, {
		kind: 'native-media-v15', profileId: 'encode-mov-prores-422-hq',
		hardwarePolicy: 'native-cpu',
		captionPolicy: { muxCodec: 'mov_text', burnIn: 'supported-opaque' },
		companionAudio: null,
	});
	const alpha = resolvePlatformDeliveryExecution(
		findPlatformDeliveryPreset('native-alpha-mezzanine')!, cleared,
	);
	assert.deepEqual(alpha?.captionPolicy, { muxCodec: 'mov_text', burnIn: 'refused-preserve-alpha' });
	const hardware = resolvePlatformDeliveryExecution(
		findPlatformDeliveryPreset('native-hardware-h264')!, cleared,
	);
	assert.equal(hardware?.hardwarePolicy, 'hardware-first-identical-cpu-retry');
	const sequence = resolvePlatformDeliveryExecution(
		findPlatformDeliveryPreset('native-image-sequence-png')!, cleared,
	);
	assert.deepEqual(sequence?.captionPolicy, {
		muxCodec: null, burnIn: 'supported-alpha-composite',
	});
	assert.deepEqual(sequence?.companionAudio, {
		required: true,
		allowedFormatIds: [
			'wav', 'bwf', 'aiff', 'flac', 'mp3', 'ogg-vorbis', 'opus', 'wavpack', 'mp2', 'aac-m4a',
		],
		defaultChoice: { formatId: 'bwf', sampleFormat: 'int24' },
	});
	assert.equal(resolvePlatformDeliveryExecution(
		findPlatformDeliveryPreset('native-image-sequence-png')!, MATRIX,
	), null, 'execution never bypasses its licensing gate');
});

test('image-sequence companion audio is a closed built-in non-ADM choice with BWF int24 default', () => {
	assert.deepEqual(
		PLATFORM_IMAGE_SEQUENCE_COMPANION_AUDIO_FORMATS_V1,
		Object.keys(MEDIA_EXPORT_FORMATS).filter((id) => id !== 'bw64' && id !== 'custom-ffmpeg'),
	);
	assert.deepEqual(DEFAULT_PLATFORM_IMAGE_SEQUENCE_COMPANION_AUDIO_V1, {
		formatId: 'bwf', sampleFormat: 'int24',
	});
	assert.deepEqual(snapshotPlatformImageSequenceCompanionAudioChoiceV1(), {
		formatId: 'bwf', sampleFormat: 'int24',
	});
	assert.deepEqual(snapshotPlatformImageSequenceCompanionAudioChoiceV1({ formatId: 'mp3' }), {
		formatId: 'mp3', sampleFormat: null,
	});
	for (const value of [
		{ formatId: 'bw64', sampleFormat: 'int24' },
		{ formatId: 'custom-ffmpeg', sampleFormat: 'int24' },
		{ formatId: 'bwf', sampleFormat: 'float32' },
		{ formatId: 'bwf', sampleFormat: 'int24', arguments: ['-f', 'wav'] },
	]) assert.throws(() => snapshotPlatformImageSequenceCompanionAudioChoiceV1(value), /built-in|support|unsupported/iu);
});

test('every gated preset hands the user somewhere to go instead', () => {
	for (const preset of PLATFORM_DELIVERY_PRESETS) {
		if (preset.licensingRowIds.length === 0) continue;
		const fallback = findPlatformDeliveryPreset(preset.fallbackPresetId);
		assert.ok(fallback, `${preset.id} degrades to nothing`);
		// The fallback chain must terminate at something that actually delivers.
		const seen = new Set([preset.id]);
		let current = fallback;
		while (current && !resolvePlatformDeliveryAvailability(current, MATRIX).available) {
			assert.equal(seen.has(current.id), false, `${preset.id} degrades in a circle`);
			seen.add(current.id);
			current = findPlatformDeliveryPreset(current.fallbackPresetId)!;
		}
		assert.ok(current, `${preset.id} degrades to nothing deliverable`);
	}
});

test('the shipped snapshot says exactly what the recorded matrix says', () => {
	const recorded = new Map(
		Object.values(MATRIX)
			.filter((value): value is Record<string, unknown>[] => Array.isArray(value))
			.flat()
			.filter((row) => row && typeof row.id === 'string')
			.map((row) => [row.id as string, row]),
	);
	for (const row of PLATFORM_DELIVERY_LICENSING_ROWS) {
		const source = recorded.get(row.id);
		assert.ok(source, `${row.id} is no longer in the matrix`);
		assert.equal(row.status, source.status, `${row.id} status drifted from the matrix`);
		assert.equal(row.blocker, source.blocker ?? null, `${row.id} blocker drifted from the matrix`);
	}
	// The snapshot must cover every row the catalog names, or a preset would
	// resolve against an absence rather than a decision.
	const shipped = new Set(PLATFORM_DELIVERY_LICENSING_ROWS.map((row) => row.id));
	for (const preset of PLATFORM_DELIVERY_PRESETS) {
		for (const rowId of preset.licensingRowIds) assert.ok(shipped.has(rowId), `${rowId} is not shipped`);
	}
});

test('the catalog resolves the same way against the snapshot as against the matrix', () => {
	for (const preset of PLATFORM_DELIVERY_PRESETS) {
		assert.deepEqual(
			{ ...resolvePlatformDeliveryAvailability(preset) },
			{ ...resolvePlatformDeliveryAvailability(preset, MATRIX) },
			preset.id,
		);
	}
});

test('a row missing from the matrix blocks rather than passing by absence', () => {
	const preset = findPlatformDeliveryPreset('native-uhd-hdr10')!;
	const availability = resolvePlatformDeliveryAvailability(preset, { nativeFormatPolicies: [] });

	assert.equal(availability.available, false);
	assert.equal(availability.status, 'unknown');
	assert.match(availability.blocker!, /No licensing row codec-encode-hevc-mp4-main10-hdr10 is recorded/u);
});

test('a preset that is not from the catalog cannot ask about itself', () => {
	assert.throws(
		() => resolvePlatformDeliveryAvailability(
			{ ...findPlatformDeliveryPreset('native-uhd-hdr10')!, licensingRowIds: [] },
			MATRIX,
		),
		/from the catalog is required/u,
	);
});

test('the dialog resolves a blocked target to what will actually be delivered', () => {
	const dialog = {
		mode: 'mix', range: 'project', format: 'video-mp4',
		canvasWidth: '', canvasHeight: '', canvasFit: 'contain',
		canvasFrameRate: '', canvasBackgroundColor: '',
		videoQuality: 'balanced', videoAudioLayout: 'preserve',
		captionTrackId: '', captionDelivery: 'mux',
	};
	const request = (deliveryTarget: string) => (
		createExportDialogRequest({ ...dialog, deliveryTarget }, { metadata: {} })
	);

	const vertical = request('web-vertical-1080');
	assert.equal(vertical.deliveryTarget, 'web-vertical-1080');
	assert.equal(Object.hasOwn(vertical, 'degradedFrom'), false);
	assert.deepEqual(vertical.canvas, { size: { width: 1_080, height: 1_920 }, fit: 'cover' });

	// 4K HDR is blocked today, so the request says what it fell back to and what
	// it fell back from, rather than quietly delivering 1080p as if asked.
	const hdr = request('native-uhd-hdr10');
	assert.equal(hdr.deliveryTarget, 'web-1080p');
	assert.equal(hdr.degradedFrom, 'native-uhd-hdr10');
	assert.deepEqual(hdr.canvas, { size: { width: 1_920, height: 1_080 } });

	// An untouched dialog names no target at all.
	assert.equal(Object.hasOwn(request(''), 'deliveryTarget'), false);
});

test('a stated dialog field still wins over the target that suggested one', () => {
	const request = createExportDialogRequest({
		mode: 'mix', range: 'project', format: 'video-mp4',
		canvasWidth: '2048', canvasHeight: '858', canvasFit: 'contain',
		canvasFrameRate: '', canvasBackgroundColor: '',
		videoQuality: 'high', videoAudioLayout: 'preserve',
		captionTrackId: '', captionDelivery: 'mux',
		deliveryTarget: 'web-1080p',
	}, { metadata: {} });

	assert.deepEqual(request.canvas, { size: { width: 2_048, height: 858 } });
	assert.equal(request.quality, 'high');
	assert.equal(request.deliveryTarget, 'web-1080p');
});

test('the report states the target, and says when it is not the one asked for', () => {
	const plan = { format: 'mp4', canvas: {}, codecs: {}, captions: null, inputs: [] };
	const chosen = inventoryVideoDeliveryConversions(plan, { deliveryTargetId: 'web-1080p' })
		.find(({ code }) => code === 'delivery.target');
	assert.equal(chosen?.severity, 'info');
	assert.deepEqual(chosen?.data, { target: 'web-1080p' });

	const degraded = inventoryVideoDeliveryConversions(plan, {
		deliveryTargetId: 'web-1080p', degradedFrom: 'native-uhd-hdr10',
	}).find(({ code }) => code === 'delivery.target');
	assert.equal(degraded?.severity, 'warning', 'the asking is what went unanswered');
	// The substitution alone does not tell an operator why it happened, and the
	// blocker is the half they can act on — it names the licensing row that has
	// to clear before the target they asked for can ever deliver.
	assert.deepEqual(degraded?.data, {
		target: 'web-1080p',
		requested: 'native-uhd-hdr10',
		blocker: resolvePlatformDeliveryAvailability(findPlatformDeliveryPreset('native-uhd-hdr10')!).blocker,
	});
	assert.match(String((degraded?.data as { blocker: string }).blocker), /HEVC/u);

	assert.equal(
		inventoryVideoDeliveryConversions(plan, {}).some(({ code }) => code === 'delivery.target'),
		false,
		'a delivery with no target named states none',
	);
});

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

test('the dialog names the target a blocked one actually falls back to', () => {
	const fields = readFileSync('src/common/editor/ui/VideoDeliveryFields.jsx', 'utf8');

	// Alpha mezzanine falls back to the ProRes mezzanine, which is blocked too, so
	// the delivery walks on to web-1080p. Reading `fallbackPresetId` once told the
	// operator they would get a ProRes mezzanine they were never going to get.
	assert.match(fields, /statedVideoDeliveryTarget\(/u);
	assert.equal(fields.includes('availability.fallbackPresetId'), false);
	assert.equal(
		statedVideoDeliveryTarget({ deliveryTarget: 'native-alpha-mezzanine' })?.presetId,
		'web-1080p',
	);
	assert.equal(findPlatformDeliveryPreset('native-alpha-mezzanine')!.fallbackPresetId, 'native-mezzanine-prores');
});
