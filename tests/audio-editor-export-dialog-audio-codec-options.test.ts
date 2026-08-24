/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	constrainExportDialogSampleRate,
	exportDialogBitRateOptions,
	exportDialogBitRateSelectionReason,
	exportDialogMaximumAudioSampleRate,
	exportDialogSampleRateSuggestions,
	exportDialogVorbisQualityOptions,
} from '../src/common/editor/ui/export-dialog-audio-codec-options.ts';

test('desktop dialog audio choices stay inside the main-process contract', () => {
	assert.equal(exportDialogBitRateOptions('opus', true).some(({ value }) => value === '320'), false);
	assert.equal(exportDialogBitRateOptions('opus', false).some(({ value }) => value === '320'), true);
	assert.equal(exportDialogBitRateOptions('mp3', true, 8_000).some(({ value }) => value === '80'), false);
	assert.equal(exportDialogBitRateOptions('mp3', true, 8_000).some(({ value }) => value === '64'), true);
	assert.equal(exportDialogBitRateOptions('aac-m4a', true, 8_000, 1).some(({ value }) => value === '64'), false);
	assert.equal(exportDialogBitRateOptions('aac-m4a', true, 8_000, 2).some(({ value }) => value === '96'), true);
	const lowRateAac = exportDialogBitRateOptions('aac-m4a', true, 8_000, 1);
	assert.match(exportDialogBitRateSelectionReason('aac-m4a', 320, lowRateAac, true) ?? '', /would be changed/iu);
	assert.equal(exportDialogBitRateSelectionReason('aac-m4a', 48, lowRateAac, true), null);
	assert.equal(exportDialogVorbisQualityOptions(true).some(({ value }) => value === '-1'), false);
	assert.equal(exportDialogVorbisQualityOptions(false).some(({ value }) => value === '-1'), true);
	assert.equal(exportDialogMaximumAudioSampleRate('opus', true), 48_000);
	assert.equal(exportDialogMaximumAudioSampleRate('aac-m4a', true), 96_000);
	assert.equal(exportDialogMaximumAudioSampleRate('opus', false), 384_000);
});

test('format changes and suggestions respect the selected surface bound', () => {
	assert.equal(constrainExportDialogSampleRate('384000', 'flac', true), '192000');
	assert.equal(constrainExportDialogSampleRate('44100', 'opus', true), '48000');
	assert.equal(constrainExportDialogSampleRate('192000', 'aac-m4a', true), '96000');
	assert.equal(constrainExportDialogSampleRate('384000', 'wav', true), '384000');
	assert.equal(constrainExportDialogSampleRate('', 'opus', true), '48000');
	assert.equal(exportDialogSampleRateSuggestions(192_000, 384_000).includes(384_000), false);
	assert.equal(exportDialogSampleRateSuggestions(384_000, 384_000).includes(384_000), true);
	assert.equal(exportDialogSampleRateSuggestions(48_000, 44_100, 'opus', true).includes(44_100), false);
	assert.equal(exportDialogSampleRateSuggestions(48_000, 44_100, 'opus', true).includes(48_000), true);
});
