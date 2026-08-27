/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	constrainExportDialogSampleRate,
	exportDialogBitRateOptions,
	exportDialogBitRateSelectionReason,
	exportDialogCompressionLevels,
	exportDialogMaximumAudioSampleRate,
	exportDialogMetadata,
	exportDialogMetadataAvailable,
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
