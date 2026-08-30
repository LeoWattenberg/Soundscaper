/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	BundledMpegAudioStreamError,
	BundledMpegAudioStreamUnsupportedError,
	parseBundledMpegAudioStream,
} from '../desktop/bundled-mpeg-audio-stream.ts';
import {
	concatenate, testMpegAudioFrame, testMpegAudioStream, withId3v1, withId3v2,
} from './helpers/mpeg-audio-fixture.ts';

test('the bounded inspector identifies exact MPEG-1 Layer III and Layer II geometry', () => {
	assert.deepEqual(parseBundledMpegAudioStream(testMpegAudioStream({
		layer: 3, frameCount: 5, channelCount: 2, sampleRate: 44_100,
	}), 'mp3'), {
		format: 'mp3', layer: 3, mpegVersion: 1, sampleRate: 44_100, channelCount: 2,
		frameCount: 5 * 1_152, mpegFrameCount: 5, samplesPerFrame: 1_152,
		bitrateKbps: 128,
		encoderDelay: 0, endPadding: 0, gapless: 'none',
	});
	assert.deepEqual(parseBundledMpegAudioStream(testMpegAudioStream({
		layer: 2, frameCount: 3, channelCount: 1, sampleRate: 48_000,
	}), 'mp2'), {
		format: 'mp2', layer: 2, mpegVersion: 1, sampleRate: 48_000, channelCount: 1,
		frameCount: 3 * 1_152, mpegFrameCount: 3, samplesPerFrame: 1_152,
		bitrateKbps: 192,
		encoderDelay: 0, endPadding: 0, gapless: 'none',
	});
});

test('the inspector exposes exact stock LAME gapless and bitrate geometry', async () => {
	const encoded = new Uint8Array(Buffer.from((await readFile(
		new URL('fixtures/mpg123-sweep-raw.base64', import.meta.url), 'utf8',
	)).trim(), 'base64'));
	assert.deepEqual(parseBundledMpegAudioStream(encoded, 'mp3'), {
		format: 'mp3', layer: 3, mpegVersion: 1, sampleRate: 44_100, channelCount: 2,
		frameCount: 44_100, mpegFrameCount: 41, samplesPerFrame: 1_152,
		bitrateKbps: null, encoderDelay: 576, endPadding: 1_404, gapless: 'lame',
	});
});

test('valid tags, protected frames, lower MPEG versions, and chaining fall through', () => {
	const mp3 = testMpegAudioStream({ layer: 3 });
	const id3v24Footer = concatenate(
		Uint8Array.of(0x49, 0x44, 0x33, 4, 0, 0x10, 0, 0, 0, 0),
		Uint8Array.of(0x33, 0x44, 0x49, 4, 0, 0x10, 0, 0, 0, 0),
		mp3,
	);
	const unsupported = [
		withId3v2(mp3), id3v24Footer, withId3v1(mp3),
		testMpegAudioStream({ layer: 3, crcProtected: true }),
		testMpegAudioStream({ layer: 3, mpegVersion: 2, sampleRate: 44_100 }),
		concatenate(testMpegAudioFrame({ layer: 3, sampleRate: 44_100 }),
			testMpegAudioFrame({ layer: 3, sampleRate: 48_000 })),
	];
	for (const stream of unsupported) assert.throws(
		() => parseBundledMpegAudioStream(stream, 'mp3'), BundledMpegAudioStreamUnsupportedError,
	);
});

test('reserved headers, truncated frames, malformed tags, and format confusion reject terminally', () => {
	const mp3 = testMpegAudioStream({ layer: 3 });
	const reserved = mp3.slice();
	reserved[1] = (reserved[1] & 0xe7) | 0x08;
	const malformedTag = withId3v2(mp3);
	malformedTag[6] = 0x80;
	for (const stream of [reserved, mp3.subarray(0, mp3.byteLength - 1), malformedTag]) {
		assert.throws(() => parseBundledMpegAudioStream(stream, 'mp3'), BundledMpegAudioStreamError);
	}
	assert.throws(
		() => parseBundledMpegAudioStream(testMpegAudioStream({ layer: 2 }), 'mp3'),
		BundledMpegAudioStreamError,
	);
	assert.throws(
		() => parseBundledMpegAudioStream(new Uint8Array(32 * 1024 * 1024 + 1), 'mp3'),
		BundledMpegAudioStreamError,
	);
});
