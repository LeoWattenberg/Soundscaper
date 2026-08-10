/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	VIDEO_SOURCE_MAXIMUM_AUDIO_STREAMS,
	createUnreportedVideoSourceCharacteristics,
	normalizeVideoSourceCharacteristics,
	videoSourceCharacteristicsAreReported,
} from '../src/common/editor/video-source-characteristics.ts';

const NTSC = { num: 30_000, den: 1_001 };
const PAL = { num: 25, den: 1 };

test('an absent probe normalizes to an explicitly unreported record', () => {
	const characteristics = normalizeVideoSourceCharacteristics(null);
	assert.deepEqual(characteristics, createUnreportedVideoSourceCharacteristics());
	assert.equal(characteristics.rotationDegrees, null, 'an unknown rotation is not zero');
	assert.equal(characteristics.fieldOrder, null, 'an unknown field order is not progressive');
	assert.equal(characteristics.hasAlpha, null, 'an unknown alpha channel is not absence');
	assert.equal(characteristics.audioStreams, null, 'an unreported inventory is not an empty one');
	assert.equal(videoSourceCharacteristicsAreReported(characteristics), false);
});

test('the reported predicate distinguishes an empty inventory from an unreported one', () => {
	assert.equal(videoSourceCharacteristicsAreReported(
		normalizeVideoSourceCharacteristics({ audioStreams: [] }),
	), true);
	assert.equal(videoSourceCharacteristicsAreReported(
		normalizeVideoSourceCharacteristics({ colour: { matrix: 'bt709' } }),
	), true);
	assert.equal(videoSourceCharacteristicsAreReported(
		normalizeVideoSourceCharacteristics({ colour: {} }),
	), false);
});

test('a full probe result survives normalization unchanged', () => {
	const characteristics = normalizeVideoSourceCharacteristics({
		backend: 'ffmpeg',
		codedWidth: 1_920,
		codedHeight: 1_080,
		rotationDegrees: 90,
		pixelAspectRatio: { num: 4, den: 3 },
		fieldOrder: 'top-field-first',
		hasAlpha: false,
		videoCodec: 'h264',
		colour: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'limited' },
		audioStreams: [
			{ index: 0, codec: 'aac', channelCount: 2, sampleRate: 48_000, language: 'eng' },
			{ index: 2, codec: 'ac3', channelCount: 6, sampleRate: 48_000, language: null },
		],
		extractedAudioStreamIndex: 0,
		startTimecode: { negative: false, hours: 1, minutes: 0, seconds: 0, frames: 0, dropFrame: true },
	}, { rate: NTSC });
	assert.equal(characteristics.backend, 'ffmpeg');
	assert.equal(characteristics.rotationDegrees, 90);
	assert.deepEqual(characteristics.pixelAspectRatio, { num: 4, den: 3 });
	assert.equal(characteristics.audioStreams?.length, 2);
	assert.equal(characteristics.audioStreams?.[1].channelCount, 6);
	assert.deepEqual(characteristics.startTimecode, {
		negative: false, hours: 1, minutes: 0, seconds: 0, frames: 0, dropFrame: true,
	});
});

test('a pixel aspect ratio persists in reduced terms', () => {
	assert.deepEqual(
		normalizeVideoSourceCharacteristics({ pixelAspectRatio: { num: 64, den: 45 } }).pixelAspectRatio,
		{ num: 64, den: 45 },
	);
	assert.deepEqual(
		normalizeVideoSourceCharacteristics({ pixelAspectRatio: { num: 1_920, den: 1_080 } }).pixelAspectRatio,
		{ num: 16, den: 9 },
	);
	assert.throws(
		() => normalizeVideoSourceCharacteristics({ pixelAspectRatio: { num: 0, den: 1 } }),
		/pixelAspectRatio\.num is out of range/,
	);
});

test('a coded frame size reports both axes or neither', () => {
	assert.throws(
		() => normalizeVideoSourceCharacteristics({ codedWidth: 1_920 }),
		/reports both axes or neither/,
	);
	assert.throws(
		() => normalizeVideoSourceCharacteristics({ codedWidth: 1_920, codedHeight: 0 }),
		/codedHeight is out of range/,
	);
	assert.throws(
		() => normalizeVideoSourceCharacteristics({ codedWidth: 1_920.5, codedHeight: 1_080 }),
		/codedWidth must be a safe integer/,
	);
});

test('enumerated characteristics reject values outside their contract', () => {
	assert.throws(
		() => normalizeVideoSourceCharacteristics({ rotationDegrees: 45 }),
		/rotationDegrees is unsupported/,
	);
	assert.throws(
		() => normalizeVideoSourceCharacteristics({ fieldOrder: 'interlaced' }),
		/fieldOrder is unsupported/,
	);
	assert.throws(
		() => normalizeVideoSourceCharacteristics({ colour: { range: 'tv' } }),
		/colour\.range is unsupported/,
	);
	assert.throws(
		() => normalizeVideoSourceCharacteristics({ hasAlpha: 'yes' }),
		/hasAlpha must be a boolean/,
	);
});

test('unsupported keys are rejected rather than dropped', () => {
	assert.throws(
		() => normalizeVideoSourceCharacteristics({ bitrate: 8_000_000 }),
		/carries the unsupported key bitrate/,
	);
	assert.throws(
		() => normalizeVideoSourceCharacteristics({ colour: { gamma: 'srgb' } }),
		/carries the unsupported key gamma/,
	);
	assert.throws(
		() => normalizeVideoSourceCharacteristics({ audioStreams: [{ index: 0, bitrate: 1 }] }),
		/carries the unsupported key bitrate/,
	);
});

test('the audio inventory stays bounded, ordered, and internally consistent', () => {
	const streams = Array.from({ length: VIDEO_SOURCE_MAXIMUM_AUDIO_STREAMS + 1 }, (unused, index) => ({
		index, codec: 'aac', channelCount: 2, sampleRate: 48_000, language: null,
	}));
	assert.throws(
		() => normalizeVideoSourceCharacteristics({ audioStreams: streams }),
		/exceeds its inventory bound/,
	);
	assert.throws(
		() => normalizeVideoSourceCharacteristics({
			audioStreams: [{ index: 1, codec: null, channelCount: null, sampleRate: null, language: null },
				{ index: 1, codec: null, channelCount: null, sampleRate: null, language: null }],
		}),
		/increasing stream indexes/,
	);
	assert.throws(
		() => normalizeVideoSourceCharacteristics({ audioStreams: [], extractedAudioStreamIndex: 0 }),
		/does not report/,
	);
	assert.throws(
		() => normalizeVideoSourceCharacteristics({ extractedAudioStreamIndex: 0 }),
		/requires a reported stream inventory/,
	);
	assert.throws(
		() => normalizeVideoSourceCharacteristics({
			audioStreams: [{ index: 0, codec: null, channelCount: null, sampleRate: null, language: 'english!' }],
		}),
		/language must be a language tag/,
	);
});

test('a source start timecode must be a label the source rate produces', () => {
	assert.throws(
		() => normalizeVideoSourceCharacteristics({
			startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0, dropFrame: false },
		}),
		/A source frame rate is required/,
	);
	assert.throws(
		() => normalizeVideoSourceCharacteristics({
			startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 25, dropFrame: false },
		}, { rate: PAL }),
		/not a label this source rate produces/,
	);
	assert.throws(
		() => normalizeVideoSourceCharacteristics({
			startTimecode: { negative: false, hours: 0, minutes: 1, seconds: 0, frames: 0, dropFrame: true },
		}, { rate: NTSC }),
		/not a label this source rate produces/,
	);
	assert.throws(
		() => normalizeVideoSourceCharacteristics({
			startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0, dropFrame: true },
		}, { rate: PAL }),
		/drop-frame source timecode requires a drop-frame source rate/,
	);
	assert.throws(
		() => normalizeVideoSourceCharacteristics({
			startTimecode: { negative: true, hours: 1, minutes: 0, seconds: 0, frames: 0, dropFrame: false },
		}, { rate: PAL }),
		/cannot be negative/,
	);
	assert.deepEqual(
		normalizeVideoSourceCharacteristics({
			startTimecode: { negative: false, hours: 0, minutes: 1, seconds: 0, frames: 2, dropFrame: true },
		}, { rate: NTSC }).startTimecode,
		{ negative: false, hours: 0, minutes: 1, seconds: 0, frames: 2, dropFrame: true },
	);
});

test('reported tags stay bounded printable text', () => {
	assert.throws(
		() => normalizeVideoSourceCharacteristics({ videoCodec: 'h264\n' }),
		/videoCodec must be a bounded printable tag/,
	);
	assert.throws(
		() => normalizeVideoSourceCharacteristics({ backend: 'x'.repeat(65) }),
		/backend must be a bounded printable tag/,
	);
	assert.throws(
		() => normalizeVideoSourceCharacteristics({ videoCodec: '' }),
		/videoCodec must be a bounded printable tag/,
	);
	assert.equal(normalizeVideoSourceCharacteristics({ videoCodec: 'h264 (High)' }).videoCodec, 'h264 (High)');
});
