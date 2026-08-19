/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	dialogSettingsFromDeliveryTarget,
	dialogSettingsFromPreset,
	presetFormatFromDialog,
	presetSettingsFromDialog,
	runDeliveryPresetAction,
} from '../src/common/editor/ui/export-preset-model.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import {
	resolveDeliveryPresetPlanOptions,
	validateDeliveryPreset,
} from '../src/common/editor/delivery-preset.ts';
import { createDeliveryPresetService } from '../src/common/editor/controller/delivery-preset-service.ts';
import {
	createExportDialogRequest,
	isVideoExportDialogFormat,
} from '../src/common/editor/ui/export-dialog-model.js';

const DIALOG = {
	mode: 'mix',
	range: 'project',
	format: 'wav',
	sampleFormat: 'int16',
	sampleRate: '44100',
	bitRate: '192',
	compressionLevel: '5',
	quality: '5',
	channelMapping: 'preserve',
	dither: 'triangular',
	includeTail: true,
	// Dialog-only state that must never reach a preset.
	metadataTitle: 'Night Session',
	channelMatrix: '',
	bext: { originator: 'x' },
	adm: null,
};

test('only preset-worthy settings cross over, with numbers as numbers', () => {
	const settings = presetSettingsFromDialog(DIALOG, 'audio');
	assert.equal(settings.sampleRate, 44_100, 'the dialog holds strings; a preset holds values');
	assert.equal(settings.sampleFormat, 'int16');
	assert.equal(settings.dither, 'triangular');
	assert.ok(!('metadataTitle' in settings), 'metadata is not a delivery setting');
	assert.ok(!('bext' in settings), 'editor state must never reach a preset');
	assert.ok(!('channelMatrix' in settings), 'an empty control contributes nothing');
	validateDeliveryPreset({
		schemaVersion: 1, id: 'p', label: 'P', kind: 'audio', format: 'wav', settings,
	});
});

test('applying a preset patches the dialog back to strings', () => {
	const preset = validateDeliveryPreset({
		schemaVersion: 1, id: 'p', label: 'CD', kind: 'audio', format: 'wav',
		settings: { sampleRate: 44_100, sampleFormat: 'int16', dither: 'triangular' },
	});
	const patch = dialogSettingsFromPreset(preset);
	assert.equal(patch.format, 'wav');
	assert.equal(patch.sampleRate, '44100', 'inputs need strings back');
	assert.equal(patch.sampleFormat, 'int16');
});

test('a dialog round trip through a preset produces the same export plan', () => {
	const project = {
		id: 'p', title: 'P', sampleRate: 48_000, masterChannels: 2,
		selection: { startFrame: 0, endFrame: 0 }, loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [], clips: [],
		tracks: [{
			type: 'audio', id: 't', name: 'A', clipIds: [], mute: false, solo: false,
			hidden: false, collapsed: false, height: 120, laneGroupId: null,
		}],
	};
	const range = { startFrame: 0, endFrame: 48_000 };
	const direct = createExportPlan(project, {
		format: 'wav', sampleRate: 44_100, sampleFormat: 'int16', dither: 'triangular', range,
	});
	const preset = validateDeliveryPreset({
		schemaVersion: 1, id: 'p', label: 'CD', kind: 'audio', format: 'wav',
		settings: presetSettingsFromDialog(DIALOG, 'audio'),
	});
	const viaPreset = createExportPlan(project, {
		...resolveDeliveryPresetPlanOptions(preset), range,
	});
	assert.deepEqual(
		JSON.parse(JSON.stringify(viaPreset)),
		JSON.parse(JSON.stringify(direct)),
		'saving settings as a preset and applying it must not change the delivery',
	);
});

const VIDEO_DIALOG = {
	...DIALOG,
	format: 'video-mp4',
	canvasWidth: '1080',
	canvasHeight: '1920',
	canvasFit: 'cover',
	canvasFrameRate: '',
	canvasBackgroundColor: '',
	videoQuality: 'balanced',
};

test('a video preset carries the canvas the dialog states and nothing the dialog cannot deliver', () => {
	const settings = presetSettingsFromDialog(VIDEO_DIALOG, 'video');

	assert.deepEqual(settings, { size: { width: 1_080, height: 1_920 }, fit: 'cover' });
	// A video preset used to leave with includeTail, which the preset schema does
	// not admit, so saving one from the dialog threw before it could be stored.
	assert.doesNotThrow(() => validateDeliveryPreset({
		schemaVersion: 1, id: 'v', label: 'Vertical', kind: 'video', format: 'mp4', settings,
	}));
});

test('a video preset carries the delivery tier only once the dialog leaves balanced', () => {
	assert.deepEqual(
		presetSettingsFromDialog({ ...VIDEO_DIALOG, videoQuality: 'high' }, 'video'),
		{ size: { width: 1_080, height: 1_920 }, fit: 'cover', quality: 'high' },
	);
	const preset = validateDeliveryPreset({
		schemaVersion: 1, id: 'v', label: 'Vertical', kind: 'video', format: 'mp4',
		settings: { quality: 'high' },
	});
	// The tier is a plan option rather than canvas geometry, so it must resolve
	// at the top level; nested under `canvas` the plan builder would refuse it.
	assert.deepEqual(resolveDeliveryPresetPlanOptions(preset), { format: 'mp4', quality: 'high' });
	// The dialog spells it `videoQuality` because `quality` is already Vorbis's.
	assert.equal(dialogSettingsFromPreset(preset).videoQuality, 'high');
});

test('an unstated video canvas keeps a preset and a request empty of geometry', () => {
	const bare = { ...VIDEO_DIALOG, canvasWidth: '', canvasHeight: '', canvasFit: 'contain' };
	const settings = presetSettingsFromDialog(bare, 'video');

	assert.deepEqual(settings, {}, 'no canvas asked for means no canvas stated');
	assert.deepEqual(
		createExportDialogRequest(bare),
		{ mode: 'mix', range: 'project', format: 'video-mp4', metadata: {} },
		'an unexercised option leaves the request exactly as it was',
	);
});

test('a stated video canvas reaches the export request as a canvas option', () => {
	assert.deepEqual(createExportDialogRequest(VIDEO_DIALOG), {
		mode: 'mix',
		range: 'project',
		format: 'video-mp4',
		metadata: {},
		canvas: { size: { width: 1_080, height: 1_920 }, fit: 'cover' },
	});
});

test('a stated rate and background join the canvas the dialog asks for', () => {
	const dialog = { ...VIDEO_DIALOG, canvasFrameRate: '29.97', canvasBackgroundColor: '#101820' };
	// 29.97 is the name of 30000/1001, so that is what both the preset and the
	// request state; the decimal is a rate no delivery is graded against.
	const canvas = {
		size: { width: 1_080, height: 1_920 },
		fit: 'cover',
		frameRate: { num: 30_000, den: 1_001 },
		backgroundColor: '#101820',
	};

	assert.deepEqual(presetSettingsFromDialog(dialog, 'video'), canvas);
	assert.deepEqual((createExportDialogRequest(dialog) as Record<string, unknown>).canvas, canvas);
	assert.deepEqual(
		presetSettingsFromDialog({ ...VIDEO_DIALOG, canvasFrameRate: '12.5' }, 'video').frameRate,
		12.5,
		'a rate the product does not name by spelling is the number it says',
	);
});

test('a preset stating an exact rational rate comes back as the name that rate has', () => {
	const preset = validateDeliveryPreset({
		schemaVersion: 1, id: 'ntsc', label: 'NTSC', kind: 'video', format: 'mp4',
		settings: { frameRate: { num: 30_000, den: 1_001 }, backgroundColor: 'black' },
	});
	const patch = dialogSettingsFromPreset(preset);

	// The dialog shows the spelling an operator recognizes, and that spelling
	// states the same rational again when the delivery is built.
	assert.equal(patch.canvasFrameRate, '29.97');
	assert.deepEqual(
		presetSettingsFromDialog({ ...VIDEO_DIALOG, canvasFrameRate: patch.canvasFrameRate }, 'video').frameRate,
		{ num: 30_000, den: 1_001 },
	);
	assert.equal(patch.canvasBackgroundColor, 'black');

	// A rational the product has no name for still round-trips as its decimal.
	const odd = validateDeliveryPreset({
		schemaVersion: 1, id: 'odd', label: 'Odd', kind: 'video', format: 'mp4',
		settings: { frameRate: { num: 25_000, den: 1_001 } },
	});
	assert.equal(dialogSettingsFromPreset(odd).canvasFrameRate, String(25_000 / 1_001));
});

test('applying a video preset patches the dialog canvas fields back to strings', () => {
	const preset = validateDeliveryPreset({
		schemaVersion: 1, id: 'v', label: 'Vertical', kind: 'video', format: 'mp4',
		settings: { size: { width: 1_080, height: 1_920 }, fit: 'cover' },
	});
	const patch = dialogSettingsFromPreset(preset);

	assert.equal(patch.canvasWidth, '1080');
	assert.equal(patch.canvasHeight, '1920');
	assert.equal(patch.canvasFit, 'cover');
	assert.ok(!('size' in patch), 'the dialog holds flat strings, never the nested preset shape');
});

test('a video preset saved from the dialog and applied back stays a video delivery', async () => {
	// The dialog names its video formats with a prefix so one list can hold both
	// kinds; a preset carries the bare codec name the plan uses. Without the
	// translation the validator refused every video preset the dialog tried to
	// save ("unknown video format: video-mp4"), and applying a hand-authored one
	// patched the dialog's format to `mp4`, which the dialog does not recognise
	// as video — so the fields vanished and Export built an audio request.
	const persisted: Array<[string, unknown]> = [];
	let ids = 0;
	const service = createDeliveryPresetService({
		state: {},
		persistSetting: (key, value) => { persisted.push([key, value]); },
		createId: (prefix) => `${prefix}-${++ids}`,
	});
	const dialog = { ...DIALOG, format: 'video-mp4', canvasWidth: '1920', canvasHeight: '1080' };
	const kind = isVideoExportDialogFormat(dialog.format) ? 'video' : 'audio';
	assert.equal(kind, 'video');

	const preset = await service.save({
		label: 'Master 1080p',
		kind,
		format: presetFormatFromDialog(dialog.format, kind),
		settings: presetSettingsFromDialog(dialog, kind),
	});
	assert.equal(preset.format, 'mp4', 'a preset carries the format the plan understands');

	const patch = dialogSettingsFromPreset(preset);
	assert.equal(patch.format, 'video-mp4', 'and applying it keeps the dialog in video mode');
	assert.ok(isVideoExportDialogFormat(patch.format));
	assert.deepEqual(
		[patch.canvasWidth, patch.canvasHeight],
		['1920', '1080'],
		'with the canvas it was saved with',
	);
});

test('a preset control reports what it refused instead of doing nothing', async () => {
	// The controls wrapped every action in a promise chain with no catch, so a
	// refusal — an unknown setting, a duplicate name, an unreadable import —
	// reached the operator as a control that did nothing, plus an unhandled
	// rejection. The message the validator composed was never shown.
	const reported: unknown[] = [];
	const busy: boolean[] = [];
	await runDeliveryPresetAction(
		() => { throw new Error('Unknown audio delivery setting: loudnessNormalization'); },
		{ onError: (cause) => reported.push(cause), onBusy: (value) => busy.push(value) },
	);

	assert.deepEqual(busy, [true, false], 'the control stops being busy either way');
	assert.equal(reported.length, 2, 'the surface is cleared, then told what happened');
	assert.equal(reported[0], null);
	assert.match(String((reported[1] as Error).message), /Unknown audio delivery setting/u);
});

test('a preset control that succeeds leaves no error behind', async () => {
	const reported: unknown[] = [];
	await runDeliveryPresetAction(async () => 'saved', { onError: (cause) => reported.push(cause) });
	assert.deepEqual(reported, [null], 'only the clear, never a message');
});

test('a loudness target chosen in the dialog reaches the plan, and a preset can carry it', () => {
	// 6A-2 put the target on the plan and nothing an operator could touch ever
	// set it: the dialog had no control, and the closed preset field list refused
	// `loudnessNormalization` outright, so batches and imported presets could not
	// reach it either. The feature was reachable only from code.
	const dialog = { ...DIALOG, customArguments: '', loudnessNormalization: 'ebu-r128' };
	const request = createExportDialogRequest(dialog, {});
	assert.equal(request.loudnessNormalization, 'ebu-r128');

	const plan = createExportPlan({
		id: 'p', title: 'P', sampleRate: 48_000, masterChannels: 2,
		selection: { startFrame: 0, endFrame: 0 }, loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [], clips: [],
		tracks: [{
			type: 'audio', id: 't', name: 'A', clipIds: [], mute: false, solo: false,
			hidden: false, collapsed: false, height: 120, laneGroupId: null,
		}],
	} as never, { ...request, range: { startFrame: 0, endFrame: 48_000 } } as never);
	assert.deepEqual(plan.loudnessNormalization, { integratedLufs: -23, truePeakCeilingDb: -1 });

	// And it survives the preset round trip, so a batch delivers the same target.
	const preset = validateDeliveryPreset({
		schemaVersion: 1, id: 'p', label: 'R128', kind: 'audio', format: 'wav',
		settings: presetSettingsFromDialog(dialog, 'audio'),
	});
	assert.equal(preset.settings.loudnessNormalization, 'ebu-r128');
	assert.equal(
		resolveDeliveryPresetPlanOptions(preset).loudnessNormalization,
		'ebu-r128',
		'a preset resolves the target into the ordinary plan options',
	);

	// An untouched dialog still states nothing, so existing deliveries are unchanged.
	assert.equal(
		'loudnessNormalization' in createExportDialogRequest({ ...DIALOG, customArguments: '' }, {}),
		false,
	);
});

test('exporting a preset writes through the preset purpose with a safe name', async () => {
	const requests: Array<Record<string, unknown>> = [];
	const service = createDeliveryPresetService({
		state: {},
		persistSetting: () => undefined,
		createId: () => 'delivery-preset-1',
		fileService: { saveFile: (request) => { requests.push(request); } },
	});
	await service.save({ label: 'CD master / 44.1', kind: 'audio', format: 'wav' });
	await service.saveToFile('delivery-preset-1');
	assert.equal(requests.length, 1);
	assert.equal(requests[0].purpose, 'preset');
	assert.equal(requests[0].suggestedName, 'CD-master-44-1.json');
	assert.match(String(requests[0].text), /"presets"/u);
});

test('the dialog controls follow the delivery target they are given', () => {
	assert.deepEqual(dialogSettingsFromDeliveryTarget('web-1080p'), {
		format: 'video-mp4', videoQuality: 'balanced',
		canvasWidth: '1920', canvasHeight: '1080', canvasFit: 'contain',
	});
	assert.deepEqual(dialogSettingsFromDeliveryTarget('web-vertical-1080'), {
		format: 'video-mp4', videoQuality: 'balanced',
		canvasWidth: '1080', canvasHeight: '1920', canvasFit: 'cover',
	});
	assert.equal(dialogSettingsFromDeliveryTarget('web-vp9-1080p')?.format, 'video-webm');
	// A blocked target resolves through its fallback, so the controls name the
	// delivery that will actually happen rather than the one asked for.
	assert.equal(dialogSettingsFromDeliveryTarget('native-uhd-hdr10')?.format, 'video-mp4');
	assert.equal(dialogSettingsFromDeliveryTarget(''), null);
	assert.equal(dialogSettingsFromDeliveryTarget('not-a-target'), null);
});
