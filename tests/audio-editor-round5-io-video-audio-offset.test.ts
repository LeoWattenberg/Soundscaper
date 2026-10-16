/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodeImportedVideoAudio } from '../src/common/editor/controller/import/internal/video-import-audio-decode.ts';
import { placeImportedVideoAudio, readVideoContainerAudioOffset } from '../src/common/editor/controller/import/internal/video-import-audio-timing.ts';
import { videoRetimePreviewMedia } from './browser/fixtures/video-retime-preview-media.js';

async function fixture() {
	const bytes = Buffer.from(await readFile(new URL('./browser/fixtures/ffmpeg-delayed-camera-audio.mp4.base64', import.meta.url), 'utf8'), 'base64');
	const channels = [new Float32Array(25_024)];
	channels[0]!.fill(0.25, 1_024);
	const decoded = { channels, sampleRate: 48_000 };
	const options = {
		file: new Blob([bytes]), projectSampleRate: 48_000, durationSeconds: 1, hasAudio: true,
		inspectEncodedSampleRate: () => 48_000,
		decodeNative: () => Promise.resolve(decoded),
		decodeContainerAudio: () => Promise.reject(new Error('AudioDecoder is unavailable')),
		decodeFfmpeg: () => Promise.resolve(decoded),
	};
	return { options, decoded };
}

test('a standard FFmpeg delayed-audio MP4 retains its silent leader after native decoding', async () => {
	const { options, decoded } = await fixture();
	const result = await decodeImportedVideoAudio(options);
	assert.equal(result.declaredAudioSampleRate, 48_000);
	assert.equal(result.decodedAudio.sampleRate, 48_000);
	const pcm = result.decodedAudio.channels?.[0];
	assert.ok(pcm);
	assert.equal(pcm.length, 48_000);
	assert.equal(pcm.findIndex((sample) => sample !== 0), 23_968);
	assert.equal(pcm[28_800], 0.25);
	assert.equal(decoded.channels[0]!.length, 25_024);
	assert.equal(decoded.channels[0]![1_024], 0.25);
});

test('a codec fallback retains the same ordinary container offset when browser decoders are unavailable', async () => {
	const { options } = await fixture();
	const result = await decodeImportedVideoAudio({
		...options,
		decodeNative: () => Promise.reject(new Error('The browser does not decode this codec')),
	});
	const pcm = result.decodedAudio.channels?.[0];
	assert.ok(pcm);
	assert.equal(pcm.findIndex((sample) => sample !== 0), 23_968);
	assert.equal(pcm[28_800], 0.25);
});

test('the timestamp-aware container fallback is not offset for a second time', async () => {
	const { options } = await fixture();
	const channels = [new Float32Array(48_000)];
	channels[0]!.fill(0.25, 24_000);
	const alreadyPlaced = { channels, sampleRate: 48_000 };
	const result = await decodeImportedVideoAudio({
		...options,
		decodeNative: () => Promise.reject(new Error('The browser does not decode this codec')),
		decodeContainerAudio: () => Promise.resolve(alreadyPlaced),
	});
	assert.equal(result.decodedAudio, alreadyPlaced);
	assert.equal(result.decodedAudio.channels?.[0]?.[24_000], 0.25);
});

test('the standard fixture demux retains its primary audio start relative to the picture', async () => {
	const { options } = await fixture();
	assert.equal(await readVideoContainerAudioOffset(options.file), 0.478);
	assert.equal(await readVideoContainerAudioOffset(new Blob([videoRetimePreviewMedia.file.buffer])), 0);
	const aligned = Buffer.from(await readFile(new URL('./browser/fixtures/ffmpeg-aligned-camera-audio.mp4.base64', import.meta.url), 'utf8'), 'base64');
	assert.equal(await readVideoContainerAudioOffset(new Blob([aligned])), 0);
});

test('earlier audio is clipped to picture zero at its own decoded sample rate', () => {
	const pcm = Float32Array.from([1, 2, 3, 4, 5, 6]);
	const result = placeImportedVideoAudio({ channels: [pcm], sampleRate: 4 }, -0.5, 1);
	assert.deepEqual(result.channels?.[0], Float32Array.from([3, 4, 5, 6]));
	assert.deepEqual(pcm, Float32Array.from([1, 2, 3, 4, 5, 6]));
});

test('native AudioBuffer planes retain channel order and the same zero-filled leader', () => {
	const left = Float32Array.from([1, 2]), right = Float32Array.from([3, 4]);
	const result = placeImportedVideoAudio({
		numberOfChannels: 2, sampleRate: 4,
		getChannelData: (channel: number) => channel === 0 ? left : right,
	}, 0.5, 1);
	assert.deepEqual(result.channels, [Float32Array.from([0, 0, 1, 2]), Float32Array.from([0, 0, 3, 4])]);
});

test('zero-offset decoding keeps its existing identity and oversized alignment remains bounded', () => {
	const audio = { channels: [Float32Array.from([0.25])], sampleRate: 48_000 };
	assert.equal(placeImportedVideoAudio(audio, 0, 1), audio);
	assert.throws(() => placeImportedVideoAudio(audio, 1, 86_400), /output bound/);
});
