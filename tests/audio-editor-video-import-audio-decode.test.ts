/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeImportedVideoAudio } from '../src/common/editor/controller/import/internal/video-import-audio-decode.ts';
import { videoRetimePreviewMedia } from './browser/fixtures/video-retime-preview-media.js';

function fixture(hasAudio?: boolean) {
	const calls: string[] = [];
	const decoded = { channels: [new Float32Array([0.25])], sampleRate: 48000 };
	const options = {
		file: new Blob([new Uint8Array(4)]), projectSampleRate: 44100, durationSeconds: 1, hasAudio,
		inspectEncodedSampleRate() { calls.push('inspect'); return 48000; },
		decodeNative() { calls.push('native'); return Promise.resolve(decoded); },
		decodeContainerAudio() { calls.push('container'); return Promise.resolve(decoded); },
		decodeFfmpeg() { calls.push('ffmpeg'); return Promise.resolve(decoded); },
	};
	return { options, calls, decoded };
}

test('a confirmed silent video bypasses every audio decoder', async () => {
	const { options, calls } = fixture(false);
	const result = await decodeImportedVideoAudio(options);
	assert.deepEqual(calls, []);
	assert.deepEqual(result, { decodedAudio: { channels: [], sampleRate: 44100 }, declaredAudioSampleRate: null });
});

for (const hasAudio of [true, undefined]) {
	test(`audio inventory ${String(hasAudio)} retains native decoding`, async () => {
		const { options, calls, decoded } = fixture(hasAudio);
		assert.equal((await decodeImportedVideoAudio(options)).decodedAudio, decoded);
		assert.deepEqual(calls, ['inspect', 'native']);
	});
}

test('an already cancelled silent import does not report success', async () => {
	const { options, calls } = fixture(false);
	await assert.rejects(decodeImportedVideoAudio({ ...options, signal: AbortSignal.abort() }), { name: 'AbortError' });
	assert.deepEqual(calls, []);
});

test('an unreported inventory is recovered from the silent MP4 container', async () => {
	const { options, calls } = fixture();
	options.file = new Blob([videoRetimePreviewMedia.file.buffer], { type: 'video/mp4' });
	const result = await decodeImportedVideoAudio(options);
	assert.deepEqual(calls, []);
	assert.deepEqual(result.decodedAudio.channels, []);
});
