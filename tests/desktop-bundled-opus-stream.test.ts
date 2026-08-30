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
	const badGranule = opusStream({ channels: 2, frameCount: 649, finalGranule: 1n });
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
	assert.throws(
		() => parseBundledOpusStream(opusStream({
			channels: 2, frameCount: 648, headVersion: 2,
			headTrailingBytes: Uint8Array.of(0xa5),
		})),
		BundledOpusStreamUnsupportedError,
	);
	assert.throws(
		() => parseBundledOpusStream(opusStream({
			channels: 2, frameCount: 648, tagTrailingBytes: Uint8Array.of(1, 2, 3),
		})),
		BundledOpusStreamUnsupportedError,
	);
	assert.throws(
		() => parseBundledOpusStream(opusStream({
			channels: 2, frameCount: 648, initialGranuleOffset: 48_000n,
		})),
		BundledOpusStreamUnsupportedError,
	);
});

test('hybrid Opus TOC configurations retain their RFC frame durations', () => {
	for (const configuration of [13, 15]) {
		assert.deepEqual(parseBundledOpusStream(opusStream({
			channels: 2,
			frameCount: 1_608,
			toc: configuration << 3,
			packetSamples: 960,
			audioPacketsPerPage: 1,
		})), {
			sampleRate: 48_000, channelCount: 2, frameCount: 1_608, preSkip: 312,
			audioPacketCount: 2,
		});
	}
	for (const configuration of [12, 14]) {
		assert.throws(() => parseBundledOpusStream(opusStream({
			channels: 2,
			frameCount: 168,
			toc: configuration << 3,
			packetSamples: 480,
		})), BundledOpusStreamUnsupportedError);
	}
});

test('strict parser keeps incompatible headers and impossible initial granules malformed', () => {
	for (const malformed of [
		opusStream({ channels: 2, frameCount: 648, headVersion: 16 }),
		opusStream({ channels: 2, frameCount: 648, finalGranule: 311n }),
	]) assert.throws(
		() => parseBundledOpusStream(malformed),
		(error: unknown) => error instanceof BundledOpusStreamError
			&& !(error instanceof BundledOpusStreamUnsupportedError),
	);
});

test('strict parser distinguishes chained and multiplexed Ogg streams for provider fallthrough', () => {
	const chained = concatBytes(
		opusStream({ channels: 1, frameCount: 648 }),
		opusStream({ channels: 1, frameCount: 648 }),
	);
	const first = opusStream({ channels: 1, frameCount: 648 });
	const second = opusStream({ channels: 1, frameCount: 648 });
	new DataView(second.buffer).setUint32(14, 0x53434f51, true);
	new DataView(second.buffer).setUint32(22, oggCrc(second.subarray(0, firstPageLength(second))), true);
	const multiplexed = concatBytes(first.subarray(0, firstPageLength(first)), second);
	for (const unsupported of [chained, multiplexed]) {
		assert.throws(() => parseBundledOpusStream(unsupported), BundledOpusStreamUnsupportedError);
	}
});

test('strict parser rejects discontinuous Ogg streams', () => {
	const continued = opusStream({ channels: 1, frameCount: 648, firstAudioContinuation: true });
	assert.throws(() => parseBundledOpusStream(continued), BundledOpusStreamError);
});

function opusStream(options: Readonly<{
	readonly audioPacketsPerPage?: number;
	readonly channels: number;
	readonly frameCount: number;
	readonly finalGranule?: bigint;
	readonly firstAudioContinuation?: boolean;
	readonly gainQ8?: number;
	readonly headTrailingBytes?: Uint8Array;
	readonly headVersion?: number;
	readonly initialGranuleOffset?: bigint;
	readonly mappingFamily?: 0 | 1;
	readonly packetSamples?: number;
	readonly tagTrailingBytes?: Uint8Array;
	readonly tags?: Uint8Array;
	readonly toc?: number;
}>): Uint8Array {
	const preSkip = 312;
	const mappingFamily = options.mappingFamily ?? 0;
	const head = new Uint8Array(mappingFamily === 0 ? 19 : 21 + options.channels);
	head.set(new TextEncoder().encode('OpusHead'));
	head[8] = options.headVersion ?? 1;
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
	const completeHead = concatBytes(head, options.headTrailingBytes ?? new Uint8Array(0));
	const tags = options.tags ?? concatBytes(
		new TextEncoder().encode('OpusTags'), u32(0), u32(0),
		options.tagTrailingBytes ?? new Uint8Array(0),
	);
	const packetSamples = options.packetSamples ?? 960;
	const packets = Math.ceil((options.frameCount + preSkip) / packetSamples);
	const audioPackets = Array.from({ length: packets }, () => Uint8Array.of(options.toc ?? 0xf8));
	const serial = 0x53434f50;
	const audioPages: Uint8Array[] = [];
	const packetsPerPage = options.audioPacketsPerPage ?? packets;
	for (let offset = 0; offset < packets; offset += packetsPerPage) {
		const pagePackets = audioPackets.slice(offset, offset + packetsPerPage);
		const final = offset + pagePackets.length === packets;
		audioPages.push(oggPage({
			packets: pagePackets,
			serial,
			sequence: 2 + audioPages.length,
			flags: (final ? 4 : 0) | (offset === 0 && options.firstAudioContinuation ? 1 : 0),
			granule: final
				? options.finalGranule
					?? BigInt(options.frameCount + preSkip) + (options.initialGranuleOffset ?? 0n)
				: BigInt(offset + pagePackets.length) * BigInt(packetSamples)
					+ (options.initialGranuleOffset ?? 0n),
		}));
	}
	return concatBytes(
		oggPage({ packets: [completeHead], serial, sequence: 0, flags: 2, granule: 0n }),
		oggPage({ packets: [tags], serial, sequence: 1, flags: 0, granule: 0n }),
		...audioPages,
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
