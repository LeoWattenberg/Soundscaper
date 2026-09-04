/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	constrainExportDialogSampleRate,
	exportDialogBitRateOptions,
	exportDialogBitRateSelectionReason,
	exportDialogCompressionLevels,
	exportDialogDefaultSampleFormat,
	exportDialogMaximumAudioSampleRate,
	exportDialogMetadata,
	exportDialogMetadataAvailable,
	exportDialogMp3BitRateModeOptions,
	exportDialogMp3QualityKey,
	exportDialogMp3QualityOptions,
	exportDialogOutputChannelCount,
	exportDialogSampleFormats,
	exportDialogSampleRateSuggestions,
	exportDialogVorbisQualityOptions,
	normalizeExportDialogAudioSettings,
} from '../src/common/editor/ui/export-dialog-audio-codec-options.ts';

test('desktop dialog audio choices stay inside the main-process contract', () => {
	assert.equal(exportDialogBitRateOptions('opus', true).some(({ value }) => value === '320'), false);
	assert.equal(exportDialogBitRateOptions('opus', false).some(({ value }) => value === '320'), false);
	assert.equal(exportDialogBitRateOptions('mp3', true, 8_000).some(({ value }) => value === '80'), false);
	assert.equal(exportDialogBitRateOptions('mp3', true, 8_000).some(({ value }) => value === '64'), true);
	assert.equal(exportDialogBitRateOptions('aac-m4a', true, 8_000, 1).some(({ value }) => value === '64'), false);
	assert.equal(exportDialogBitRateOptions('aac-m4a', true, 8_000, 2).some(({ value }) => value === '96'), true);
	const lowRateAac = exportDialogBitRateOptions('aac-m4a', true, 8_000, 1);
	assert.match(exportDialogBitRateSelectionReason('aac-m4a', 320, lowRateAac, true) ?? '', /would be changed/iu);
	assert.equal(exportDialogBitRateSelectionReason('aac-m4a', 48, lowRateAac, true), null);
	assert.equal(exportDialogVorbisQualityOptions(true).some(({ value }) => value === '-1'), false);
	assert.equal(exportDialogVorbisQualityOptions(false).some(({ value }) => value === '-1'), false);
	assert.equal(exportDialogMaximumAudioSampleRate('opus', true), 48_000);
	assert.equal(exportDialogMaximumAudioSampleRate('aac-m4a', true), 96_000);
	assert.equal(exportDialogMaximumAudioSampleRate('opus', false), 48_000);
	assert.deepEqual(exportDialogSampleFormats('flac', false), ['int24']);
	assert.deepEqual(exportDialogSampleFormats('wavpack', false), ['float32']);
	assert.equal(exportDialogDefaultSampleFormat('bwf', false, 'int16'), 'int24');
	assert.equal(exportDialogDefaultSampleFormat('aif', false, 'int16'), 'int24');
	assert.equal(exportDialogDefaultSampleFormat('wavpack', false, 'int24'), 'float32');
	assert.equal(exportDialogDefaultSampleFormat('video-mp4', false, 'int24'), 'int24');
	assert.deepEqual(exportDialogCompressionLevels('wavpack', false), [2]);
});

test('format changes and suggestions respect the selected surface bound', () => {
	assert.equal(constrainExportDialogSampleRate('384000', 'flac', true), '192000');
	assert.equal(constrainExportDialogSampleRate('44100', 'opus', true), '48000');
	assert.equal(constrainExportDialogSampleRate('192000', 'aac-m4a', true), '96000');
	assert.equal(constrainExportDialogSampleRate('384000', 'wav', true), '384000');
	assert.equal(constrainExportDialogSampleRate('', 'opus', true), '48000');
	assert.equal(constrainExportDialogSampleRate('44100', 'opus', false), '48000');
	assert.equal(constrainExportDialogSampleRate('40000', 'mp3', false), '44100');
	assert.equal(exportDialogSampleRateSuggestions(192_000, 384_000).includes(384_000), false);
	assert.equal(exportDialogSampleRateSuggestions(384_000, 384_000).includes(384_000), true);
	assert.equal(exportDialogSampleRateSuggestions(48_000, 44_100, 'opus', true).includes(44_100), false);
	assert.equal(exportDialogSampleRateSuggestions(48_000, 44_100, 'opus', true).includes(48_000), true);
	assert.deepEqual(exportDialogSampleRateSuggestions(48_000, 44_100, 'opus', false), [48_000]);
});

test('browser codec options and stale settings stay inside dedicated profiles', () => {
	assert.deepEqual(exportDialogBitRateOptions('mp2', false, 48_000, 1).map(({ value }) => value), [
		'128', '160', '192',
	]);
	assert.deepEqual(exportDialogBitRateOptions('mp2', false, 48_000, 2).map(({ value }) => value), [
		'128', '160', '192', '224', '256', '320', '384',
	]);
	assert.deepEqual(normalizeExportDialogAudioSettings({
		format: 'opus', sampleRate: '44100', bitRate: '320', channelMapping: 'preserve',
	}, false, 6), {
		format: 'opus', sampleRate: '48000', bitRate: '256', channelMapping: 'stereo',
	});
	assert.deepEqual(normalizeExportDialogAudioSettings({
		format: 'ogg-vorbis', sampleRate: '384000', quality: '-1',
		channelMapping: 'custom', channelMatrix: JSON.stringify({ channels: [0, 1, 0] }),
	}, false, 6), {
		format: 'ogg-vorbis', sampleRate: '192000', quality: '0',
		channelMapping: 'stereo', channelMatrix: JSON.stringify({ channels: [0, 1, 0] }),
	});
	assert.equal(normalizeExportDialogAudioSettings({
		format: 'flac', sampleRate: '-1', compressionLevel: '99', channelMapping: 'preserve',
	}, false, 6).compressionLevel, '8');
	assert.equal(normalizeExportDialogAudioSettings({
		format: 'wavpack', sampleRate: '48000.6', compressionLevel: '5', channelMapping: 'preserve',
	}, false, 6).compressionLevel, '2');
	assert.deepEqual(normalizeExportDialogAudioSettings({
		format: 'mp2', sampleRate: '48000', bitRate: '384', channelMapping: 'mono',
	}, false, 6), {
		format: 'mp2', sampleRate: '48000', bitRate: '192', channelMapping: 'mono',
	});
	const desktopSettings = { format: 'opus', sampleRate: '44100', bitRate: '320', channelMapping: 'preserve' };
	assert.strictEqual(normalizeExportDialogAudioSettings(desktopSettings, true, 6), desktopSettings);
});

test('browser codec channel projection recognizes custom mappings without admitting surround', () => {
	assert.equal(exportDialogOutputChannelCount({ channelMapping: 'preserve' }, 6), 6);
	assert.equal(exportDialogOutputChannelCount({ channelMapping: 'mono' }, 6), 1);
	assert.equal(exportDialogOutputChannelCount({ channelMapping: 'stereo' }, 6), 2);
	assert.equal(exportDialogOutputChannelCount({
		channelMapping: 'custom', channelMatrix: JSON.stringify({ channels: [0, 1] }),
	}, 6), 2);
	assert.equal(exportDialogOutputChannelCount({ channelMapping: { channels: [0, 1, 0] } }, 6), 3);
	assert.equal(normalizeExportDialogAudioSettings({
		format: 'opus', sampleRate: '48000', bitRate: '160', channelMapping: { channels: [0, 1] },
	}, false, 6).channelMapping, 'custom');
});

test('dedicated browser formats make unsupported metadata explicit and omit its tags', () => {
	const metadata = Object.freeze({ title: 'No hidden tags' });
	for (const format of ['flac', 'mp3', 'ogg-vorbis', 'opus', 'wavpack', 'mp2']) {
		assert.equal(exportDialogMetadataAvailable(format, false), false, format);
		assert.deepEqual(exportDialogMetadata(format, false, metadata), {}, format);
		assert.equal(exportDialogMetadataAvailable(format, true), true, `${format}:desktop`);
		assert.strictEqual(exportDialogMetadata(format, true, metadata), metadata, `${format}:desktop`);
	}
	assert.equal(exportDialogMetadataAvailable('aac-m4a', false), true);
	assert.strictEqual(exportDialogMetadata('aac-m4a', false, metadata), metadata);
});

const MP3_COPY = Object.freeze({
	bitRateModePreset: 'Preset', bitRateModeVariable: 'Variable',
	bitRateModeAverage: 'Average', bitRateModeConstant: 'Constant',
	mp3PresetExcessive: 'Excessive, 320 kbps', mp3PresetExtreme: 'Extreme, 220-260 kbps',
	mp3PresetStandard: 'Standard, 170-210 kbps', mp3PresetMedium: 'Medium, 145-185 kbps',
	mp3VariableBest: '220-260 kbps (Best Quality)', mp3VariableSmallest: '45-85 kbps (Smaller files)',
});

test("the MP3 rows are Audacity's four modes and their own quality lists", () => {
	assert.deepEqual(exportDialogMp3BitRateModeOptions(MP3_COPY), [
		{ value: 'preset', label: 'Preset' },
		{ value: 'variable', label: 'Variable' },
		{ value: 'average', label: 'Average' },
		{ value: 'constant', label: 'Constant' },
	]);

	assert.deepEqual(exportDialogMp3QualityOptions('preset', MP3_COPY, false).map(({ label }) => label), [
		'Excessive, 320 kbps', 'Extreme, 220-260 kbps',
		'Standard, 170-210 kbps', 'Medium, 145-185 kbps',
	]);

	const variable = exportDialogMp3QualityOptions('variable', MP3_COPY, false);
	assert.equal(variable.length, 10);
	assert.deepEqual(variable[0], { value: '0', label: '220-260 kbps (Best Quality)' });
	assert.deepEqual(variable[4], { value: '4', label: '145-185 kbps' });
	assert.deepEqual(variable[9], { value: '9', label: '45-85 kbps (Smaller files)' });

	/* Average and constant reuse the admitted kbps list for the current tuple. */
	for (const mode of ['average', 'constant']) {
		const rates = exportDialogMp3QualityOptions(mode, MP3_COPY, false, 44_100, 2);
		assert.deepEqual(rates[0], { value: '64', label: '64 kbps' });
		assert.equal(rates.at(-1)?.value, '320');
	}
	/* The reviewed profile refuses the lowest rates at the wider tuples. */
	assert.equal(
		exportDialogMp3QualityOptions('constant', MP3_COPY, false, 44_100, 1)[0]?.value, '56',
	);
	assert.equal(
		exportDialogMp3QualityOptions('constant', MP3_COPY, false, 32_000, 1)[0]?.value, '40',
	);

	assert.equal(exportDialogMp3QualityKey('preset'), 'bitRatePreset');
	assert.equal(exportDialogMp3QualityKey('variable'), 'vbrQuality');
	assert.equal(exportDialogMp3QualityKey('average'), 'averageBitRate');
	assert.equal(exportDialogMp3QualityKey('constant'), 'bitRate');
});

test('stale MP3 dialog settings are pulled back into their own rows', () => {
	const normalized = normalizeExportDialogAudioSettings({
		format: 'mp3', sampleRate: '44100', channelMapping: 'stereo',
		bitRateMode: 'insane', bitRatePreset: '9', vbrQuality: '-3', bitRate: '17',
		averageBitRate: '1000',
	}, false);
	assert.equal(normalized.bitRateMode, 'preset');
	assert.equal(normalized.bitRatePreset, '3');
	assert.equal(normalized.vbrQuality, '0');
	assert.equal(normalized.bitRate, '64');
	assert.equal(normalized.averageBitRate, '320');
});
