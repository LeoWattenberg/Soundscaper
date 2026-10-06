/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { partitionWorkspaceFiles } from '../src/common/editor/ui/workspace/workspace-file-routing.js';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { labelExportFileName } from '../src/common/editor/controller/shared/app-helpers.ts';
import {
	serializeSubRipLabels, parseSubRipLabels, serializeWebVttLabels, parseWebVttLabels,
} from '../src/common/editor/label-io.js';
import {
	dialogSettingsFromDeliveryTarget, dialogSettingsFromPreset, presetSettingsFromDialog,
} from '../src/common/editor/ui/export-preset-model.ts';
import { validateDeliveryPreset } from '../src/common/editor/delivery-preset.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import { normalizeExportDialogAudioSettings, exportDialogOutputChannelCount } from '../src/common/editor/ui/export-dialog-audio-codec-options.ts';

test('timed label exports give points and submillisecond ranges the minimum cue duration', () => {
	const labels = [
		{ id: 'point', title: 'At the playhead', startFrame: 48_000, endFrame: 48_000 },
		{ id: 'short', title: 'A very short selection', startFrame: 96_000, endFrame: 96_001 },
	];
	for (const [serialize, parse] of [
		[serializeSubRipLabels, parseSubRipLabels],
		[serializeWebVttLabels, parseWebVttLabels],
	] as const) {
		const parsed = parse(serialize(labels, { sampleRate: 48_000 }), { sampleRate: 48_000 });
		assert.deepEqual(parsed.labels.map(({ startFrame, endFrame }) => [startFrame, endFrame]), [
			[48_000, 48_048], [96_000, 96_048],
		]);
	}
	assert.deepEqual(labels.map(({ startFrame, endFrame }) => [startFrame, endFrame]), [
		[48_000, 48_000], [96_000, 96_001],
	], 'serialization must leave the original point and range untouched');
});

test('the explicit letterbox choice overrides a vertical delivery target crop', () => {
	const settings = {
		...createExportDialogInitialSettings({}),
		...dialogSettingsFromDeliveryTarget('web-vertical-1080'),
		deliveryTarget: 'web-vertical-1080',
	};
	assert.equal(settings.canvasFit, 'cover');
	const request = createExportDialogRequest({ ...settings, canvasFit: 'contain' });
	assert.equal((request.canvas as { fit: string }).fit, 'contain');
});

test('importing an ordinary legacy Audacity project reaches the project opener', () => {
	const project = { name: 'Album.AUP', type: 'application/x-audacity-project' };
	assert.deepEqual(partitionWorkspaceFiles([project]), {
		projects: [project], media: [], labels: [], cues: [],
	});
});

test('export metadata keeps a title cleared in Project properties empty', () => {
	assert.equal(createExportDialogInitialSettings({
		title: 'Session name', metadata: { title: '' },
	}).metadataTitle, '');
});

test('label exports preserve periods in a project title and replace label file suffixes', () => {
	assert.equal(labelExportFileName('Episode 1.2', 'srt'), 'Episode 1.2.srt');
	assert.equal(labelExportFileName('Captions.VTT', 'srt'), 'Captions.srt');
});

test('a label containing an ordinary arrow can be exported and reopened as SRT', () => {
	const text = serializeSubRipLabels([{ title: 'Intro --> Verse', startFrame: 0, endFrame: 48_000 }]);
	assert.equal(parseSubRipLabels(text).labels[0]?.title, 'Intro --> Verse');
});

test('WebVTT exports encode literal label punctuation and import it as visible text', () => {
	const title = '5 < 10 & 20 > 15 --> conclusion';
	const text = serializeWebVttLabels([{ title, startFrame: 0, endFrame: 48_000 }]);
	assert.ok(text.includes('5 &lt; 10 &amp; 20 &gt; 15 --&gt; conclusion'));
	assert.equal(parseWebVttLabels(text).labels[0]?.title, title);
});

test('saving custom channel routing stores the matrix instead of the dialog sentinel', () => {
	const matrix = { channels: [{ inputs: [{ channel: 1, gain: 1 }] }] };
	const settings = presetSettingsFromDialog({
		channelMapping: 'custom', channelMatrix: JSON.stringify(matrix),
	}, 'audio');
	assert.deepEqual(settings.channelMapping, matrix);
	const preset = validateDeliveryPreset({
		schemaVersion: 1, id: 'routing', label: 'Right to mono', kind: 'audio', format: 'wav', settings,
	});
	const restored = dialogSettingsFromPreset(preset);
	assert.equal(restored.channelMapping, 'custom');
	assert.deepEqual(JSON.parse(String(restored.channelMatrix)), matrix);
});

test('marker chapter presets retain their source when applied in a new export dialog', () => {
	const settings = presetSettingsFromDialog({ mode: 'chapters', chapterSource: 'markers' }, 'audio');
	const preset = validateDeliveryPreset({
		schemaVersion: 1, id: 'markers', label: 'Marker chapters', kind: 'audio', format: 'wav', settings,
	});
	assert.equal(dialogSettingsFromPreset(preset).chapterSource, 'markers');
});

test('delivery presets retain and reset the embedded label chapter option', () => {
	const stored = presetSettingsFromDialog({ embedLabelChapters: true }, 'audio');
	assert.equal(stored.embedLabelChapters, true);
	assert.equal(dialogSettingsFromPreset(validateDeliveryPreset({
		schemaVersion: 1, id: 'single-file-chapters', label: 'Single-file chapters',
		kind: 'audio', format: 'mp3', settings: stored,
	})).embedLabelChapters, true);
	assert.equal(dialogSettingsFromPreset(validateDeliveryPreset({
		schemaVersion: 1, id: 'ordinary-mp3', label: 'Ordinary MP3',
		kind: 'audio', format: 'mp3', settings: {},
	})).embedLabelChapters, false);
});

test('applying a saved video preset clears a previously chosen platform delivery target', () => {
	const preset = validateDeliveryPreset({
		schemaVersion: 1, id: 'mp4', label: 'My MP4', kind: 'video', format: 'mp4', settings: {},
	});
	assert.equal(dialogSettingsFromPreset(preset).deliveryTarget, '');
});

test('chapter and stem requests omit the mix rendering options hidden by their output selection', () => {
	const mix = { ...createExportDialogInitialSettings({ sampleRate: 48_000 }), loudnessNormalization: 'streaming-14', binaural: true };
	assert.equal(createExportDialogRequest(mix).loudnessNormalization, 'streaming-14');
	assert.equal(createExportDialogRequest(mix).binaural, true);
	for (const mode of ['chapters', 'stems']) {
		assert.equal(createExportDialogRequest({ ...mix, mode }).loudnessNormalization, undefined);
		assert.equal(createExportDialogRequest({ ...mix, mode }).binaural, undefined);
		for (const desktop of [false, true]) {
			const split = normalizeExportDialogAudioSettings({ ...mix, mode }, desktop, 6);
			assert.equal(split.binaural, false);
			assert.equal(split.loudnessNormalization, '');
			assert.equal(exportDialogOutputChannelCount(split, 6), 6);
		}
	}
});
