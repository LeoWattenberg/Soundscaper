/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { loadBundledVorbisAudioCodecRuntime } from '../desktop/bundled-vorbis-audio-codec-runtime.ts';
import {
	BundledVorbisStreamError,
	BundledVorbisStreamUnsupportedError,
	parseBundledVorbisStream,
} from '../desktop/bundled-vorbis-stream.ts';
import { deriveDesktopAudioCodecOperation } from '../desktop/desktop-audio-codec-broker.ts';
import type { DesktopAudioCodecProviderExecutionResult } from '../desktop/desktop-audio-codec-broker.ts';
import type { DesktopAudioCodecRequest } from '../desktop/desktop-audio-codec-operation-contract.ts';

test('strict Ogg Vorbis parser derives geometry from a real reviewed stream', async () => {
	const encoded = await realStream();
	const geometry = parseBundledVorbisStream(encoded);
	assert.equal(geometry.sampleRate, 48_000);
	assert.equal(geometry.channelCount, 2);
	assert.equal(geometry.frameCount, 2_400);
	assert.ok(geometry.audioPacketCount > 0);
});

test('strict parser keeps checksum, sequence, truncation, and impossible granules malformed', async () => {
	const valid = await realStream();
	const checksum = valid.slice();
	checksum[checksum.byteLength - 1] ^= 1;
	const sequence = valid.slice();
	const second = oggPageLengthAt(sequence, 0);
	new DataView(sequence.buffer).setUint32(second + 18, 99, true);
	const repeatedBos = valid.slice();
	repeatedBos[second + 5] |= 2;
	writePageCrc(repeatedBos, second, oggPageLengthAt(repeatedBos, second));
	const impossibleGranule = valid.slice();
	const last = lastOggPageOffset(impossibleGranule);
	new DataView(impossibleGranule.buffer).setBigUint64(last + 6, 0n, true);
	writePageCrc(impossibleGranule, last, impossibleGranule.byteLength - last);
	for (const malformed of [
		valid.subarray(0, valid.byteLength - 1), checksum, sequence, repeatedBos, impossibleGranule,
	]) assert.throws(
		() => parseBundledVorbisStream(malformed),
		(error: unknown) => error instanceof BundledVorbisStreamError
			&& !(error instanceof BundledVorbisStreamUnsupportedError),
	);
});

test('strict parser treats a valid chained logical stream as unreviewed fallthrough', async () => {
	const valid = await realStream();
	const chained = concatBytes(valid, valid);
	assert.throws(() => parseBundledVorbisStream(chained), BundledVorbisStreamUnsupportedError);
});

test('maximum setup-packet lacing has linear packet-copy work', () => {
	const setupBytes = 2 * 1024 * 1024;
	const stream = maximallyLacedSetupStream(setupBytes);
	const originalSet = Uint8Array.prototype.set;
	let copiedBytes = 0;
	Uint8Array.prototype.set = function countedSet(
		this: Uint8Array,
		source: ArrayLike<number>,
		offset?: number,
	): void {
		copiedBytes += source.length;
		if (copiedBytes > setupBytes + 1024) {
			throw new Error('The bounded Vorbis parser recopied packet prefixes.');
		}
		originalSet.call(this, source, offset);
	};
	try {
		assert.deepEqual(parseBundledVorbisStream(stream), {
			sampleRate: 48_000, channelCount: 2, frameCount: 1, audioPacketCount: 1,
		});
	} finally {
		Uint8Array.prototype.set = originalSet;
	}
	assert.equal(copiedBytes, setupBytes + 30 + 16 + 1);
});

async function realStream(): Promise<Uint8Array> {
	const runtime = await loadBundledVorbisAudioCodecRuntime({ target: 'linux-x64' });
	assert.ok(runtime);
	const request = {
		operation: 'audio-encode', format: 'ogg-vorbis',
		input: new Uint8Array(Float32Array.from({ length: 2_400 * 2 }, (_, index) => (
			Math.sin(index / 23) * 0.25
		)).buffer),
		sampleRate: 48_000, channelCount: 2, settings: { quality: 6 },
		maximumOutputBytes: 1024 * 1024,
	} as const satisfies DesktopAudioCodecRequest;
	const result = await runtime.execute(request, {
		operation: deriveDesktopAudioCodecOperation(request),
	}) as DesktopAudioCodecProviderExecutionResult;
	assert.equal(result.status, 'executed');
	if (result.status !== 'executed') throw new Error('Vorbis fixture encoding failed.');
	return result.output;
}

function maximallyLacedSetupStream(setupBytes: number): Uint8Array {
	const marker = new TextEncoder().encode('vorbis');
	const identification = new Uint8Array(30);
	identification[0] = 1;
	identification.set(marker, 1);
	identification[11] = 2;
	new DataView(identification.buffer).setUint32(12, 48_000, true);
	identification[28] = 0xb8;
	identification[29] = 1;
	const comments = new Uint8Array(16);
	comments[0] = 3;
	comments.set(marker, 1);
	comments[15] = 1;
	const setup = new Uint8Array(setupBytes);
	setup[0] = 5;
	setup.set(marker, 1);
	const serial = 0x53435642;
	let sequence = 0;
	const pages = [
		oggPage({ lacing: [identification.byteLength], body: identification, serial, sequence: sequence++, flags: 2, granule: 0n }),
		oggPage({ lacing: [comments.byteLength], body: comments, serial, sequence: sequence++, flags: 0, granule: 0n }),
	];
	const setupLacing = Array.from({ length: Math.floor(setup.byteLength / 255) }, () => 255);
	setupLacing.push(setup.byteLength % 255);
	let setupOffset = 0;
	for (let lacingOffset = 0; lacingOffset < setupLacing.length; lacingOffset += 255) {
		const lacing = setupLacing.slice(lacingOffset, lacingOffset + 255);
		const bodyBytes = lacing.reduce((total, value) => total + value, 0);
		pages.push(oggPage({
			lacing, body: setup.subarray(setupOffset, setupOffset + bodyBytes), serial,
			sequence: sequence++, flags: lacingOffset === 0 ? 0 : 1, granule: 0n,
		}));
		setupOffset += bodyBytes;
	}
	pages.push(oggPage({
		lacing: [1], body: Uint8Array.of(0), serial, sequence, flags: 4, granule: 1n,
	}));
	return concatBytes(...pages);
}

function oggPage(options: Readonly<{
	readonly lacing: readonly number[];
	readonly body: Uint8Array;
	readonly serial: number;
	readonly sequence: number;
	readonly flags: number;
	readonly granule: bigint;
}>): Uint8Array {
	const page = new Uint8Array(27 + options.lacing.length + options.body.byteLength);
	page.set(new TextEncoder().encode('OggS'));
	page[5] = options.flags;
	const view = new DataView(page.buffer);
	view.setBigUint64(6, options.granule, true);
	view.setUint32(14, options.serial, true);
	view.setUint32(18, options.sequence, true);
	page[26] = options.lacing.length;
	page.set(options.lacing, 27);
	page.set(options.body, 27 + options.lacing.length);
	view.setUint32(22, oggCrc(page), true);
	return page;
}

function lastOggPageOffset(stream: Uint8Array): number {
	let offset = 0;
	let last = 0;
	while (offset < stream.byteLength) {
		last = offset;
		offset += oggPageLengthAt(stream, offset);
	}
	return last;
}

function oggPageLengthAt(stream: Uint8Array, offset: number): number {
	const segments = stream[offset + 26];
	let body = 0;
	for (let index = 0; index < segments; index++) body += stream[offset + 27 + index];
	return 27 + segments + body;
}

function writePageCrc(stream: Uint8Array, offset: number, pageLength: number): void {
	const view = new DataView(stream.buffer);
	view.setUint32(offset + 22, 0, true);
	view.setUint32(offset + 22, oggCrc(stream.subarray(offset, offset + pageLength)), true);
}

function oggCrc(bytes: Uint8Array): number {
	let crc = 0;
	for (let index = 0; index < bytes.byteLength; index++) {
		crc ^= (index >= 22 && index < 26 ? 0 : bytes[index]) << 24;
		for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000_0000
			? (crc << 1) ^ 0x04c1_1db7 : crc << 1;
	}
	return crc >>> 0;
}

function concatBytes(...values: readonly Uint8Array[]): Uint8Array {
	const output = new Uint8Array(values.reduce((total, value) => total + value.byteLength, 0));
	let offset = 0;
	for (const value of values) { output.set(value, offset); offset += value.byteLength; }
	return output;
}
