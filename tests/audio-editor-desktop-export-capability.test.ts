/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { assertDesktopAudioExportCapability } from '../src/common/editor/controller/desktop-audio-export-capability.ts';
import { DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER } from '../src/common/editor/desktop-main-audio-codec-runtime-marker.ts';

test('desktop export gate requires the exact planned encode tuple before rendering', async () => {
	const queries: unknown[] = [];
	const runtime = {
		[DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER]: true as const,
			desktopAudioCodecCapabilities(query: { operations: readonly Record<string, unknown>[] }) {
			queries.push(query);
			return Promise.resolve({
				schemaVersion: 2 as const,
				capabilities: query.operations.map((operation) => ({
					...operation, available: false as const, provider: null,
					reason: 'configure-external-ffmpeg' as const,
				})),
			});
		},
	};
	await assert.rejects(
		() => assertDesktopAudioExportCapability(runtime, {
			format: 'opus', sampleRate: 48_000, channelCount: 6, encoding: { bitRate: 128 },
		}),
		/Preferences > General/iu,
	);
	assert.deepEqual((queries[0] as { operations: unknown[] }).operations, [
		{
			operation: 'audio-encode', format: 'opus', sampleRate: 48_000, channelCount: 6,
			settings: { bitrateKbps: 128 },
		},
	]);
});

test('browser runtimes and native desktop formats remain unchanged', async () => {
	await assert.doesNotReject(assertDesktopAudioExportCapability({}, {
		format: 'opus', sampleRate: 48_000, channelCount: 2,
	}));
	await assert.doesNotReject(assertDesktopAudioExportCapability({
		[DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER]: true,
	}, { format: 'wav', sampleRate: 384_000, channelCount: 32 }));
});

test('WavPack re-queries exact levels so unsupported bundled settings can fall through', async () => {
	const settings: unknown[] = [];
	const runtime = {
		[DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER]: true as const,
		desktopAudioCodecCapabilities(query: { operations: readonly Record<string, unknown>[] }) {
			settings.push(query.operations[0]?.settings);
			return Promise.resolve({
				schemaVersion: 2 as const,
				capabilities: query.operations.map((operation) => ({
					...operation, available: true as const,
					provider: (operation.settings as { compressionLevel: number }).compressionLevel === 2
						? 'bundled' as const : 'external-ffmpeg' as const,
					reason: null,
				})),
			});
		},
	};
	await assert.doesNotReject(assertDesktopAudioExportCapability(runtime, {
		format: 'wavpack', sampleRate: 48_000, channelCount: 2,
		encoding: { compressionLevel: 1 },
	}));
	await assert.doesNotReject(assertDesktopAudioExportCapability(runtime, {
		format: 'wavpack', sampleRate: 48_000, channelCount: 2,
		encoding: { compressionLevel: 2 },
	}));
	assert.deepEqual(settings, [{ compressionLevel: 1 }, { compressionLevel: 2 }]);
});

test('FLAC re-queries exact bit depth and level so bundled misses can fall through', async () => {
	const settings: unknown[] = [];
	const runtime = {
		[DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER]: true as const,
		desktopAudioCodecCapabilities(query: { operations: readonly Record<string, unknown>[] }) {
			settings.push(query.operations[0]?.settings);
			return Promise.resolve({
				schemaVersion: 2 as const,
				capabilities: query.operations.map((operation) => ({
					...operation, available: true as const,
					provider: (operation.settings as { bitDepth: number; compressionLevel: number }).bitDepth === 24
						&& (operation.settings as { compressionLevel: number }).compressionLevel <= 8
						? 'bundled' as const : 'external-ffmpeg' as const,
					reason: null,
				})),
			});
		},
	};
	await assert.doesNotReject(assertDesktopAudioExportCapability(runtime, {
		format: 'flac', sampleRate: 48_000, channelCount: 2,
		encoding: { compressionLevel: 5, bitDepth: 16, sampleFormat: 'int16' },
	}));
	await assert.doesNotReject(assertDesktopAudioExportCapability(runtime, {
		format: 'flac', sampleRate: 48_000, channelCount: 2,
		encoding: { compressionLevel: 9, bitDepth: 24, sampleFormat: 'int24' },
	}));
	await assert.doesNotReject(assertDesktopAudioExportCapability(runtime, {
		format: 'flac', sampleRate: 48_000, channelCount: 2,
		encoding: { compressionLevel: 8, bitDepth: 24, sampleFormat: 'int24' },
	}));
	assert.deepEqual(settings, [
		{ compressionLevel: 5, bitDepth: 16 },
		{ compressionLevel: 9, bitDepth: 24 },
		{ compressionLevel: 8, bitDepth: 24 },
	]);
});
