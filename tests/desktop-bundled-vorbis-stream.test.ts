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
