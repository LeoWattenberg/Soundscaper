/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BundledOpusStreamError,
	BundledOpusStreamUnsupportedError,
	parseBundledOpusStream,
} from '../desktop/bundled-opus-stream.ts';

test('strict bundled Ogg Opus parser derives the 48 kHz presentation geometry', () => {
	assert.deepEqual(parseBundledOpusStream(opusStream({ channels: 1, frameCount: 648 })), {
		sampleRate: 48_000, channelCount: 1, frameCount: 648, preSkip: 312,
		audioPacketCount: 1,
	});
	assert.deepEqual(parseBundledOpusStream(opusStream({ channels: 2, frameCount: 1_608 })), {
		sampleRate: 48_000, channelCount: 2, frameCount: 1_608, preSkip: 312,
		audioPacketCount: 2,
	});
});

test('strict bundled Ogg Opus parser makes malformed framing and metadata terminal', () => {
	const valid = opusStream({ channels: 2, frameCount: 648 });
	const checksum = Uint8Array.from(valid);
	checksum[checksum.length - 1] ^= 1;
	const sequence = Uint8Array.from(valid);
	new DataView(sequence.buffer).setUint32(firstPageLength(sequence) + 18, 7, true);
	const badGranule = opusStream({ channels: 2, frameCount: 649, finalGranule: 10_000n });
	for (const malformed of [
		valid.subarray(0, valid.length - 1), checksum, sequence, badGranule,
		opusStream({ channels: 2, frameCount: 648, tags: Uint8Array.from([1, 2, 3]) }),
	]) {
		assert.throws(
			() => parseBundledOpusStream(malformed),
			(error: unknown) => error instanceof BundledOpusStreamError
				&& !(error instanceof BundledOpusStreamUnsupportedError),
		);
	}
});

test('strict parser distinguishes valid but unreviewed Opus profiles for provider fallthrough', () => {
	assert.throws(
		() => parseBundledOpusStream(opusStream({ channels: 2, frameCount: 168, toc: 0xf0 })),
		BundledOpusStreamUnsupportedError,
	);
	assert.throws(
		() => parseBundledOpusStream(opusStream({ channels: 3, frameCount: 648, mappingFamily: 1 })),
		BundledOpusStreamUnsupportedError,
	);
	assert.throws(
		() => parseBundledOpusStream(opusStream({ channels: 2, frameCount: 648, gainQ8: 256 })),
		BundledOpusStreamUnsupportedError,
	);
});

test('strict parser rejects chained, discontinuous, and checksum-invalid Ogg streams', () => {
	const chained = concatBytes(
		opusStream({ channels: 1, frameCount: 648 }),
		opusStream({ channels: 1, frameCount: 648 }),
	);
	const continued = opusStream({ channels: 1, frameCount: 648, firstAudioContinuation: true });
	for (const malformed of [chained, continued]) {
		assert.throws(() => parseBundledOpusStream(malformed), BundledOpusStreamError);
	}
});

function opusStream(options: Readonly<{
	readonly channels: number;
	readonly frameCount: number;
	readonly finalGranule?: bigint;
	readonly firstAudioContinuation?: boolean;
	readonly gainQ8?: number;
	readonly mappingFamily?: 0 | 1;
	readonly tags?: Uint8Array;
	readonly toc?: number;
}>): Uint8Array {
	const preSkip = 312;
	const mappingFamily = options.mappingFamily ?? 0;
	const head = new Uint8Array(mappingFamily === 0 ? 19 : 21 + options.channels);
	head.set(new TextEncoder().encode('OpusHead'));
	head[8] = 1;
	head[9] = options.channels;
	const headView = new DataView(head.buffer);
	headView.setUint16(10, preSkip, true);
	headView.setUint32(12, 48_000, true);
	headView.setInt16(16, options.gainQ8 ?? 0, true);
	head[18] = mappingFamily;
	if (mappingFamily === 1) {
		head[19] = 2;
		head[20] = 1;
		for (let channel = 0; channel < options.channels; channel++) head[21 + channel] = channel;
	}
	const tags = options.tags ?? concatBytes(
		new TextEncoder().encode('OpusTags'), u32(0), u32(0),
	);
	const packets = Math.ceil((options.frameCount + preSkip) / 960);
	const audioPackets = Array.from({ length: packets }, () => Uint8Array.of(options.toc ?? 0xf8));
	const serial = 0x53434f50;
	return concatBytes(
		oggPage({ packets: [head], serial, sequence: 0, flags: 2, granule: 0n }),
		oggPage({ packets: [tags], serial, sequence: 1, flags: 0, granule: 0n }),
		oggPage({
			packets: audioPackets, serial, sequence: 2,
			flags: 4 | (options.firstAudioContinuation ? 1 : 0),
			granule: options.finalGranule ?? BigInt(options.frameCount + preSkip),
		}),
	);
}

function oggPage(options: Readonly<{
	readonly packets: readonly Uint8Array[];
	readonly serial: number;
	readonly sequence: number;
	readonly flags: number;
	readonly granule: bigint;
}>): Uint8Array {
	const lacing = options.packets.flatMap((packet) => {
		const values = Array.from({ length: Math.floor(packet.byteLength / 255) }, () => 255);
		values.push(packet.byteLength % 255);
		return values;
	});
	const body = concatBytes(...options.packets);
	const page = new Uint8Array(27 + lacing.length + body.byteLength);
	page.set(new TextEncoder().encode('OggS'));
	page[5] = options.flags;
	const view = new DataView(page.buffer);
	view.setBigUint64(6, options.granule, true);
	view.setUint32(14, options.serial, true);
	view.setUint32(18, options.sequence, true);
	page[26] = lacing.length;
	page.set(lacing, 27);
	page.set(body, 27 + lacing.length);
	view.setUint32(22, oggCrc(page), true);
	return page;
}

function oggCrc(bytes: Uint8Array): number {
	let crc = 0;
	for (let index = 0; index < bytes.byteLength; index++) {
		const value = index >= 22 && index < 26 ? 0 : bytes[index];
		crc ^= value << 24;
		for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000_0000
			? (crc << 1) ^ 0x04c1_1db7 : crc << 1;
	}
	return crc >>> 0;
}

function firstPageLength(stream: Uint8Array): number {
	const segments = stream[26];
	let body = 0;
	for (let index = 0; index < segments; index++) body += stream[27 + index];
	return 27 + segments + body;
}

function u32(value: number): Uint8Array {
	const result = new Uint8Array(4);
	new DataView(result.buffer).setUint32(0, value, true);
	return result;
}

function concatBytes(...values: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(values.reduce((total, value) => total + value.byteLength, 0));
	let offset = 0;
	for (const value of values) { result.set(value, offset); offset += value.byteLength; }
	return result;
}
