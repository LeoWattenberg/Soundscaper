/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDesktopExportCodecQuery,
	desktopExportBitRates,
	desktopExportCodecCapabilities,
	desktopExportFormatAvailable,
	desktopExportFormatReason,
	desktopExportFlacSampleFormats,
	desktopExportMaximumSampleRate,
	desktopExportSelectionReason,
	desktopExportVorbisQualities,
	desktopExportWavPackCompressionLevels,
} from '../src/common/editor/ui/desktop-export-codec-model.ts';

test('desktop export choices stay inside the closed operation contract', () => {
	assert.deepEqual(desktopExportBitRates('opus'), [16, 24, 32, 48, 64, 80, 96, 112, 128, 160, 192, 256]);
	assert.equal(desktopExportBitRates('opus').includes(320), false);
	assert.deepEqual(desktopExportBitRates('mp3'), [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]);
	assert.deepEqual(desktopExportBitRates('mp3', 8_000), [32, 40, 48, 56, 64]);
	assert.deepEqual(desktopExportBitRates('mp3', 24_000), [32, 40, 48, 56, 64, 80, 96, 112, 128, 160]);
	assert.deepEqual(desktopExportBitRates('mp3', 48_000), [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]);
	assert.deepEqual(desktopExportBitRates('aac-m4a', 8_000, 1), [32, 48]);
	assert.deepEqual(desktopExportBitRates('aac-m4a', 8_000, 2), [32, 48, 64, 80, 96]);
	assert.equal(desktopExportBitRates('aac-m4a', 48_000, 1).includes(320), false);
	assert.equal(desktopExportBitRates('aac-m4a', 48_000, 2).includes(320), true);
	assert.deepEqual(desktopExportVorbisQualities(), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
	assert.equal(desktopExportMaximumSampleRate('opus'), 48_000);
	assert.equal(desktopExportMaximumSampleRate('mp3'), 48_000);
	assert.equal(desktopExportMaximumSampleRate('aac-m4a'), 96_000);
	assert.equal(desktopExportMaximumSampleRate('flac'), 192_000);
	assert.equal(desktopExportMaximumSampleRate('wav'), 384_000);
});

test('desktop export codec query follows current planned sample and channel geometry', () => {
	const preserved = createDesktopExportCodecQuery({
		format: 'flac', sampleFormat: 'int16', compressionLevel: '7',
		sampleRate: '96000', channelMapping: 'preserve', binaural: false,
	}, 6);
	assert.equal(preserved.operations.length, 7);
	assert.equal(preserved.operations.every(({ operation }) => operation === 'audio-encode'), true);
	assert.equal(preserved.operations.every(({ sampleRate, channelCount }) => sampleRate === 96_000 && channelCount === 6), true);
	assert.deepEqual(preserved.operations.find(({ format }) => format === 'flac')?.settings, {
		compressionLevel: 7, bitDepth: 16,
	});
	assert.deepEqual(preserved.operations.find(({ format }) => format === 'wavpack')?.settings, {
		compressionLevel: 2,
	});
	const custom = createDesktopExportCodecQuery({
		sampleRate: '48000', channelMapping: 'custom', channelMatrix: '{"channels":[{}, {}, {}]}',
	}, 2);
	assert.equal(custom.operations[0]?.channelCount, 3);
	const binaural = createDesktopExportCodecQuery({
		sampleRate: '48000', channelMapping: 'preserve', binaural: true,
	}, 8);
	assert.equal(binaural.operations[0]?.channelCount, 2);
});

test('desktop format choices stay fail-closed while native formats remain available', () => {
	const query = createDesktopExportCodecQuery({
		sampleRate: '48000', channelMapping: 'stereo', binaural: false,
	}, 2);
	const unavailable = desktopExportCodecCapabilities(null, query);
	assert.equal(desktopExportFormatAvailable('wav', unavailable), true);
	assert.equal(desktopExportFormatAvailable('opus', unavailable), false);
	assert.equal(desktopExportFormatAvailable('custom-ffmpeg', unavailable), false);
	assert.match(desktopExportFormatReason('opus', unavailable) ?? '', /Preferences > General/iu);
	const result = {
		schemaVersion: 2 as const,
		capabilities: query.operations.map((operation) => operation.format === 'opus'
			? { ...operation, available: true as const, provider: 'external-ffmpeg' as const, reason: null }
			: { ...operation, available: false as const, provider: null, reason: 'unsupported-by-configured-ffmpeg' as const }),
	};
	const partial = desktopExportCodecCapabilities(result, query);
	assert.equal(desktopExportFormatAvailable('opus', partial), true);
	assert.equal(desktopExportFormatAvailable('mp3', partial), false);
});

test('desktop WavPack quality choices remain selectable for exact fallback queries', () => {
	assert.deepEqual(desktopExportWavPackCompressionLevels(), [0, 1, 2, 3, 4, 5]);
});

test('desktop FLAC bit depths remain selectable for exact fallback queries', () => {
	assert.deepEqual(desktopExportFlacSampleFormats(), ['int16', 'int24']);
});

test('desktop selection authority comes from the exact settings capability result', () => {
	for (const selection of [
		{ format: 'flac', sampleFormat: 'int16', compressionLevel: '5' },
		{ format: 'wavpack', sampleFormat: 'int24', compressionLevel: '5' },
	]) {
		const query = createDesktopExportCodecQuery({
			...selection, sampleRate: '48000', channelMapping: 'stereo', binaural: false,
		}, 2);
		const capabilities = desktopExportCodecCapabilities({
			schemaVersion: 2,
			capabilities: query.operations.map((operation) => operation.format === selection.format
				? { ...operation, available: true as const, provider: 'external-ffmpeg' as const, reason: null }
				: { ...operation, available: false as const, provider: null, reason: 'unsupported-by-configured-ffmpeg' as const }),
		}, query);
		assert.equal(desktopExportSelectionReason(selection, capabilities), null);
	}
});
