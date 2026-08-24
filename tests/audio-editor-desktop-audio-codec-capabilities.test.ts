/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DESKTOP_AUDIO_CODEC_PREFERENCES_REASON,
	createDesktopAudioCodecCapabilityQuery,
	desktopAudioCodecMediaExportCapabilities,
} from '../src/common/editor/desktop-audio-codec-capabilities.ts';

test('desktop media capabilities are fail-closed until exact main tuples are admitted', () => {
	const query = createDesktopAudioCodecCapabilityQuery({ sampleRate: 48_000, channelCount: 2 });
	assert.equal(query.operations.length, 14);
	const unavailable = desktopAudioCodecMediaExportCapabilities(null, query);
	for (const format of ['flac', 'mp3', 'ogg-vorbis', 'opus', 'wavpack', 'mp2', 'aac-m4a']) {
		assert.equal(unavailable.formats[format]?.available, false, format);
		assert.equal(unavailable.formats[format]?.reason, DESKTOP_AUDIO_CODEC_PREFERENCES_REASON);
	}
	for (const format of ['wav', 'bwf', 'bw64', 'aiff']) {
		assert.equal(unavailable.formats[format]?.available, true, format);
	}
	assert.equal(unavailable.formats['custom-ffmpeg']?.available, false);
});

test('desktop media capabilities expose only admitted encode tuples and sanitize reasons', () => {
	const query = createDesktopAudioCodecCapabilityQuery({ sampleRate: 48_000, channelCount: 2 });
	const result = {
		schemaVersion: 1 as const,
		capabilities: query.operations.map((operation) => operation.format === 'opus'
			? { ...operation, available: true as const, provider: 'external-ffmpeg' as const, reason: null }
			: { ...operation, available: false as const, provider: null, reason: 'unsupported-by-configured-ffmpeg' as const }),
	};
	const capabilities = desktopAudioCodecMediaExportCapabilities(result, query);
	assert.equal(capabilities.ffmpegAvailable, true);
	assert.equal(capabilities.formats.opus?.available, true);
	assert.equal(capabilities.formats.flac?.available, false);
	assert.match(capabilities.formats.flac?.reason ?? '', /Preferences > General/iu);
	assert.equal(JSON.stringify(capabilities).includes('/'), false);
});
