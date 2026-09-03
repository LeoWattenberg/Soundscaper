import test from 'node:test';
import assert from 'node:assert/strict';

import {
	inspectDecodedAudioSampleRate,
	inspectEncodedAudioSampleRate,
} from '../src/common/editor/audio-file-metadata.js';
import { encodeWav } from '../src/common/editor/wav.js';

test('encoded audio metadata preserves rates from common native decode containers', () => {
	const wav = encodeWav([Float32Array.of(0)], {
		sampleRate: 22_050,
		bitDepth: 16,
		dither: false,
	});
	assert.equal(inspectEncodedAudioSampleRate(wav), 22_050);
	assert.equal(inspectEncodedAudioSampleRate(aiff(44_100)), 44_100);
	assert.equal(inspectEncodedAudioSampleRate(flac(96_000)), 96_000);
	assert.equal(inspectEncodedAudioSampleRate(oggVorbis(32_000)), 32_000);
	assert.equal(inspectEncodedAudioSampleRate(oggOpus()), 48_000);
	assert.equal(inspectEncodedAudioSampleRate(mp3(32_000)), 32_000);
	assert.equal(inspectEncodedAudioSampleRate(adts(44_100)), 44_100);
});

test('decode-rate inspection reports only the rates a decoder is bound to emit', () => {
	assert.equal(inspectDecodedAudioSampleRate(flac(96_000)), 96_000);
	assert.equal(inspectDecodedAudioSampleRate(oggVorbis(32_000)), 32_000);
	assert.equal(inspectDecodedAudioSampleRate(oggOpus()), 48_000);
	assert.equal(inspectDecodedAudioSampleRate(mp3(32_000)), 32_000);
	assert.equal(inspectDecodedAudioSampleRate(wavPack(44_100)), 44_100);
	assert.equal(inspectDecodedAudioSampleRate(null), null);
});

test('decode-rate inspection withholds the core rate AAC reconstructs above', () => {
	// Spectral band replication emits twice the declared rate, so pinning a
	// decode to the header would resample the reconstructed band away.
	const elementaryStream = adts(44_100);
	assert.equal(inspectEncodedAudioSampleRate(elementaryStream), 44_100);
	assert.equal(inspectDecodedAudioSampleRate(elementaryStream), null);

	const media = isoMedia(track('soun', 1_000, 48_000));
	assert.equal(inspectEncodedAudioSampleRate(media), 48_000);
	assert.equal(inspectDecodedAudioSampleRate(media), null);
});

test('ISO media inspection reads the audio sample entry instead of a track timescale', () => {
	const media = concatenate(
		box('ftyp', asciiBytes('isom0000')),
		box('moov', concatenate(
			track('vide', 90_000),
			track('soun', 1_000, 48_000),
		)),
	);
	assert.equal(inspectEncodedAudioSampleRate(media), 48_000);
});

test('ISO media inspection validates versioned MP4A sample-entry bounds', () => {
	assert.equal(inspectEncodedAudioSampleRate(isoMedia(track('soun', 1_000, 44_100, { version: 1 }))), 44_100);
	assert.equal(inspectEncodedAudioSampleRate(isoMedia(track('soun', 1_000, 96_000, { version: 2 }))), 96_000);
	for (const [version, payloadBytes] of [[0, 27], [1, 43], [2, 63]]) {
		assert.equal(
			inspectEncodedAudioSampleRate(isoMedia(track('soun', 1_000, 48_000, { version, payloadBytes }))),
			null,
		);
	}
});

test('ISO sound tracks read the shared rate header from non-AAC sample entries', () => {
	assert.equal(inspectEncodedAudioSampleRate(isoMedia(track('soun', 1_000, 44_100, { entryType: 'alac' }))), 44_100);
	assert.equal(inspectEncodedAudioSampleRate(isoMedia(track('soun', 1_000, 48_000, { entryType: 'enca' }))), 48_000);
});

test('fallback-oriented WavPack and WMA headers expose their source rates', () => {
	const wavPack = new Uint8Array(32);
	wavPack.set(asciiBytes('wvpk'), 0);
	new DataView(wavPack.buffer).setUint32(24, 9 << 23, true);
	assert.equal(inspectEncodedAudioSampleRate(wavPack), 44_100);

	const asf = new Uint8Array(126);
	asf.set([
		0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11,
		0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c,
	], 0);
	asf.set([
		0x91, 0x07, 0xdc, 0xb7, 0xb7, 0xa9, 0xcf, 0x11,
		0x8e, 0xe6, 0x00, 0xc0, 0x0c, 0x20, 0x53, 0x65,
	], 30);
	const view = new DataView(asf.buffer);
	view.setUint32(46, 96, true);
	asf.set([
		0x40, 0x9e, 0x69, 0xf8, 0x4d, 0x5b, 0xcf, 0x11,
		0xa8, 0xfd, 0x00, 0x80, 0x5f, 0x5c, 0x44, 0x2b,
	], 54);
	view.setUint32(94, 18, true);
	view.setUint32(112, 48_000, true);
	assert.equal(inspectEncodedAudioSampleRate(asf), 48_000);
});

test('metadata inspection is offset-safe and rejects malformed or implausible headers', () => {
	const wav = encodeWav([Float32Array.of(0)], {
		sampleRate: 48_000,
		bitDepth: 16,
		dither: false,
	});
	const padded = new Uint8Array(wav.byteLength + 7);
	padded.set(wav, 3);
	assert.equal(inspectEncodedAudioSampleRate(padded.subarray(3, 3 + wav.byteLength)), 48_000);
	assert.equal(inspectEncodedAudioSampleRate(Uint8Array.of(0xff, 0xfb, 0xfc, 0)), null);
	assert.equal(inspectEncodedAudioSampleRate(Uint8Array.of(0x52, 0x49, 0x46, 0x46)), null);
	assert.equal(inspectEncodedAudioSampleRate(Uint8Array.of(
		0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0,
		0xff, 0xfb, 0x90, 0,
	)), null, 'sync bytes inside an unknown container are not treated as an elementary stream');
	assert.equal(inspectEncodedAudioSampleRate(null), null);
});

function aiff(rate) {
	assert.equal(rate, 44_100);
	const bytes = new Uint8Array(38);
	const view = new DataView(bytes.buffer);
	bytes.set(asciiBytes('FORM'), 0);
	view.setUint32(4, 30, false);
	bytes.set(asciiBytes('AIFF'), 8);
	bytes.set(asciiBytes('COMM'), 12);
	view.setUint32(16, 18, false);
	view.setUint16(20, 1, false);
	view.setUint16(26, 16, false);
	bytes.set([0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0], 28);
	return bytes;
}

function flac(rate) {
	const bytes = new Uint8Array(42);
	bytes.set(asciiBytes('fLaC'), 0);
	bytes[4] = 0x80;
	bytes[7] = 34;
	bytes[18] = rate >>> 12;
	bytes[19] = rate >>> 4;
	bytes[20] = (rate & 0x0f) << 4;
	return bytes;
}

function oggVorbis(rate) {
	const bytes = new Uint8Array(64);
	bytes.set(asciiBytes('OggS'), 0);
	bytes[28] = 1;
	bytes.set(asciiBytes('vorbis'), 29);
	new DataView(bytes.buffer).setUint32(40, rate, true);
	return bytes;
}

function oggOpus() {
	const bytes = new Uint8Array(64);
	bytes.set(asciiBytes('OggS'), 0);
	bytes.set(asciiBytes('OpusHead'), 28);
	new DataView(bytes.buffer).setUint32(40, 44_100, true);
	return bytes;
}

function mp3(rate) {
	assert.equal(rate, 32_000);
	return Uint8Array.of(
		...asciiBytes('ID3'), 4, 0, 0, 0, 0, 0, 0,
		0xff, 0xfb, 0x98, 0,
	);
}

function wavPack(rate) {
	assert.equal(rate, 44_100);
	const bytes = new Uint8Array(32);
	bytes.set(asciiBytes('wvpk'), 0);
	new DataView(bytes.buffer).setUint32(24, 9 << 23, true);
	return bytes;
}

function adts(rate) {
	assert.equal(rate, 44_100);
	return Uint8Array.of(0xff, 0xf1, 0x50, 0x80, 0, 0, 0);
}

function track(handler, timescale, audioSampleRate = null, options = {}) {
	const mediaHeader = new Uint8Array(24);
	new DataView(mediaHeader.buffer).setUint32(12, timescale, false);
	const handlerPayload = new Uint8Array(12);
	handlerPayload.set(asciiBytes(handler), 8);
	const mediaInformation = audioSampleRate === null
		? new Uint8Array()
		: box('minf', box('stbl', sampleDescription(audioSampleRate, options)));
	return box('trak', box('mdia', concatenate(
		box('hdlr', handlerPayload),
		box('mdhd', mediaHeader),
		mediaInformation,
	)));
}

function sampleDescription(rate, { entryType = 'mp4a', payloadBytes = null, version = 0 }) {
	const requiredPayloadBytes = version === 1 ? 44 : version === 2 ? 64 : 28;
	const audioSampleEntry = new Uint8Array(payloadBytes ?? requiredPayloadBytes);
	const view = new DataView(audioSampleEntry.buffer);
	view.setUint16(8, version, false);
	view.setUint16(16, 2, false);
	view.setUint16(18, 16, false);
	if (version === 2 && audioSampleEntry.byteLength >= 40) view.setFloat64(32, rate, false);
	else if (audioSampleEntry.byteLength >= 28) view.setUint32(24, rate * 65_536, false);
	const entry = box(entryType, audioSampleEntry);
	const description = new Uint8Array(8 + entry.byteLength);
	new DataView(description.buffer).setUint32(4, 1, false);
	description.set(entry, 8);
	return box('stsd', description);
}

function isoMedia(...tracks) {
	return concatenate(box('ftyp', asciiBytes('isom0000')), box('moov', concatenate(...tracks)));
}

function box(type, payload) {
	const bytes = new Uint8Array(8 + payload.byteLength);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, bytes.byteLength, false);
	bytes.set(asciiBytes(type), 4);
	bytes.set(payload, 8);
	return bytes;
}

function concatenate(...parts) {
	const bytes = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.byteLength;
	}
	return bytes;
}

function asciiBytes(value) {
	return Uint8Array.from(value, (character) => character.charCodeAt(0));
}
