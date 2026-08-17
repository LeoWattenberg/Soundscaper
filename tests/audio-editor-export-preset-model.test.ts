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
