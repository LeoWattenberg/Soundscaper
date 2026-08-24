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
				schemaVersion: 1 as const,
				capabilities: query.operations.map((operation) => ({
					...operation, available: false as const, provider: null,
					reason: 'configure-external-ffmpeg' as const,
				})),
			});
		},
	};
	await assert.rejects(
		() => assertDesktopAudioExportCapability(runtime, { format: 'opus', sampleRate: 48_000, channelCount: 6 }),
		/Preferences > General/iu,
	);
	assert.deepEqual((queries[0] as { operations: unknown[] }).operations, [
		{ operation: 'audio-encode', format: 'opus', sampleRate: 48_000, channelCount: 6 },
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
