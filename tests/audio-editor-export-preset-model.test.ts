/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	dialogSettingsFromPreset,
	presetSettingsFromDialog,
} from '../src/common/editor/ui/export-preset-model.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import {
	resolveDeliveryPresetPlanOptions,
	validateDeliveryPreset,
} from '../src/common/editor/delivery-preset.ts';
import { createDeliveryPresetService } from '../src/common/editor/controller/delivery-preset-service.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';

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

	assert.deepEqual(presetSettingsFromDialog(dialog, 'video'), {
		size: { width: 1_080, height: 1_920 },
		fit: 'cover',
		frameRate: 29.97,
		backgroundColor: '#101820',
	});
	assert.deepEqual((createExportDialogRequest(dialog) as Record<string, unknown>).canvas, {
		size: { width: 1_080, height: 1_920 },
		fit: 'cover',
		frameRate: 29.97,
		backgroundColor: '#101820',
	});
});

test('a preset stating an exact rational rate comes back as the decimal the dialog holds', () => {
	const preset = validateDeliveryPreset({
		schemaVersion: 1, id: 'ntsc', label: 'NTSC', kind: 'video', format: 'mp4',
		settings: { frameRate: { num: 30_000, den: 1_001 }, backgroundColor: 'black' },
	});
	const patch = dialogSettingsFromPreset(preset);

	assert.equal(patch.canvasFrameRate, String(30_000 / 1_001));
	assert.equal(patch.canvasBackgroundColor, 'black');
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
