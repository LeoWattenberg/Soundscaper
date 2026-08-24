/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDesktopExportCodecQuery,
	desktopExportCodecCapabilities,
	desktopExportFormatAvailable,
	desktopExportFormatReason,
	desktopExportFlacSampleFormats,
	desktopExportWavPackCompressionLevels,
} from '../src/common/editor/ui/desktop-export-codec-model.ts';

test('desktop export codec query follows current planned sample and channel geometry', () => {
	const preserved = createDesktopExportCodecQuery({
		sampleRate: '96000', channelMapping: 'preserve', binaural: false,
	}, 6);
	assert.equal(preserved.operations.length, 7);
	assert.equal(preserved.operations.every(({ operation }) => operation === 'audio-encode'), true);
	assert.equal(preserved.operations.every(({ sampleRate, channelCount }) => sampleRate === 96_000 && channelCount === 6), true);
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
		schemaVersion: 1 as const,
		capabilities: query.operations.map((operation) => operation.format === 'opus'
			? { ...operation, available: true as const, provider: 'external-ffmpeg' as const, reason: null }
			: { ...operation, available: false as const, provider: null, reason: 'unsupported-by-configured-ffmpeg' as const }),
	};
	const partial = desktopExportCodecCapabilities(result, query);
	assert.equal(desktopExportFormatAvailable('opus', partial), true);
	assert.equal(desktopExportFormatAvailable('mp3', partial), false);
});

test('desktop WavPack quality choices follow the selected provider', () => {
	const query = createDesktopExportCodecQuery({
		sampleRate: '48000', channelMapping: 'stereo', binaural: false,
	}, 2);
	const result = (provider: 'bundled' | 'external-ffmpeg') => ({
		schemaVersion: 1 as const,
		capabilities: query.operations.map((operation) => operation.format === 'wavpack'
			? { ...operation, available: true as const, provider, reason: null }
			: { ...operation, available: false as const, provider: null, reason: 'unsupported-by-configured-ffmpeg' as const }),
	});
	assert.deepEqual(
		desktopExportWavPackCompressionLevels(desktopExportCodecCapabilities(result('bundled'), query)),
		[2],
	);
	assert.deepEqual(
		desktopExportWavPackCompressionLevels(desktopExportCodecCapabilities(result('external-ffmpeg'), query)),
		[0, 1, 2, 3, 4, 5],
	);
});

test('bundled FLAC exposes only the signed-24 PCM profile its receipt reports', () => {
	const query = createDesktopExportCodecQuery({
		sampleRate: '48000', channelMapping: 'stereo', binaural: false,
	}, 2);
	const result = (provider: 'bundled' | 'external-ffmpeg') => ({
		schemaVersion: 1 as const,
		capabilities: query.operations.map((operation) => operation.format === 'flac'
			? { ...operation, available: true as const, provider, reason: null }
			: { ...operation, available: false as const, provider: null, reason: 'unsupported-by-configured-ffmpeg' as const }),
	});
	assert.deepEqual(
		desktopExportFlacSampleFormats(desktopExportCodecCapabilities(result('bundled'), query)),
		['int24'],
	);
	assert.deepEqual(
		desktopExportFlacSampleFormats(desktopExportCodecCapabilities(result('external-ffmpeg'), query)),
		['int16', 'int24'],
	);
});
