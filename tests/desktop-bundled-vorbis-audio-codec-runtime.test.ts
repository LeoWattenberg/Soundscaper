/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BUNDLED_VORBIS_WASM_BYTE_LENGTH,
	BUNDLED_VORBIS_WASM_SHA256,
	loadBundledVorbisAudioCodecRuntime,
} from '../desktop/bundled-vorbis-audio-codec-runtime.ts';
import { parseBundledVorbisStream } from '../desktop/bundled-vorbis-stream.ts';
import { deriveDesktopAudioCodecOperation } from '../desktop/desktop-audio-codec-broker.ts';
import type {
	DesktopAudioCodecProviderExecutionResult,
	DesktopAudioCodecProviderRuntime,
} from '../desktop/desktop-audio-codec-broker.ts';
import type { DesktopAudioCodecRequest } from '../desktop/desktop-audio-codec-operation-contract.ts';
import { DESKTOP_CODEC_TARGETS } from '../src/common/editor/desktop-codec-provider-catalog.ts';

test('the exact artifact gates a narrow Ogg Vorbis provider on all five targets', async () => {
	for (const target of DESKTOP_CODEC_TARGETS) {
		const runtime = await loadBundledVorbisAudioCodecRuntime({ target });
		assert.ok(runtime, target);
		assert.equal(runtime.provider.kind, 'bundled');
		assert.equal(runtime.provider.implementation, 'libvorbis-libogg-wasm-f32');
		assert.match(runtime.provider.capabilityGeneration, new RegExp(BUNDLED_VORBIS_WASM_SHA256, 'u'));
	}
	assert.equal(BUNDLED_VORBIS_WASM_BYTE_LENGTH, 523_227);
	assert.equal(await loadBundledVorbisAudioCodecRuntime({
		target: 'win-x64', readPayload: async () => new Uint8Array(BUNDLED_VORBIS_WASM_BYTE_LENGTH),
	}), null);
	await assert.rejects(loadBundledVorbisAudioCodecRuntime({
		target: 'mac-x64' as 'mac-arm64',
	}), /target/iu);
});

test('reviewed Vorbis encoding and decoding preserve source geometry with lossy qualification', async () => {
	const runtime = await requiredRuntime('linux-x64');
	for (const fixture of [
		{ frameCount: 4_800, channelCount: 2, sampleRate: 48_000, quality: 6 },
		{ frameCount: 800, channelCount: 1, sampleRate: 8_000, quality: 0 },
		{ frameCount: 3_840, channelCount: 2, sampleRate: 192_000, quality: 10 },
	] as const) {
		const source = sinePcm(fixture.frameCount, fixture.channelCount, fixture.sampleRate);
		const encoded = await execute(runtime, encodeRequest(source, fixture));
		assert.equal(encoded.status, 'executed', JSON.stringify(fixture));
		if (encoded.status !== 'executed') continue;
		assert.equal(Buffer.from(encoded.output.subarray(0, 4)).toString('ascii'), 'OggS');
		const geometry = parseBundledVorbisStream(encoded.output);
		assert.deepEqual({
			sampleRate: geometry.sampleRate, channelCount: geometry.channelCount,
			frameCount: geometry.frameCount,
		}, {
			sampleRate: fixture.sampleRate, channelCount: fixture.channelCount,
			frameCount: fixture.frameCount,
		});
		assert.ok(geometry.audioPacketCount > 0);
		const decoded = await execute(runtime, decodeRequest(encoded.output));
		assert.equal(decoded.status, 'executed', JSON.stringify(fixture));
		if (decoded.status !== 'executed') continue;
		assert.deepEqual(decoded.decodedGeometry, {
			sampleRate: fixture.sampleRate, channelCount: fixture.channelCount,
			frameCount: fixture.frameCount,
		});
		assert.ok(snr(source, decoded.output) > 10, JSON.stringify(fixture));
	}
});

test('exact request preflight falls through only for valid unreviewed Vorbis profiles', async () => {
	const runtime = await requiredRuntime('win-arm64');
	const threeChannel = encodeRequest(sinePcm(960, 3, 48_000), {
		frameCount: 960, channelCount: 3, sampleRate: 48_000, quality: 6,
	});
	assert.equal((await runtime.preflightRequest?.(threeChannel, {
		operation: deriveDesktopAudioCodecOperation(threeChannel),
	}))?.disposition, 'unsupported');
	const encoded = await execute(runtime, encodeRequest(sinePcm(960, 1, 48_000), {
		frameCount: 960, channelCount: 1, sampleRate: 48_000, quality: 5,
	}));
	assert.equal(encoded.status, 'executed');
	if (encoded.status !== 'executed') return;
	const chained = concatBytes(encoded.output, encoded.output);
	assert.equal((await runtime.preflightRequest?.(decodeRequest(chained), {
		operation: deriveDesktopAudioCodecOperation(decodeRequest(chained)),
	}))?.disposition, 'unsupported');
	const forgedUnreviewed = encoded.output.slice();
	const firstPageBytes = oggPageLengthAt(forgedUnreviewed, 0);
	const identificationOffset = 27 + forgedUnreviewed[26];
	forgedUnreviewed[identificationOffset + 11] = 3;
	writePageCrc(forgedUnreviewed, 0, firstPageBytes);
	const setupByte = oggPacketByteLocation(forgedUnreviewed, 2, 7);
	forgedUnreviewed[setupByte.byteOffset] ^= 0xff;
	writePageCrc(forgedUnreviewed, setupByte.pageOffset, setupByte.pageLength);
	assert.equal((await runtime.preflightRequest?.(decodeRequest(forgedUnreviewed), {
		operation: deriveDesktopAudioCodecOperation(decodeRequest(forgedUnreviewed)),
	}))?.disposition, 'rejected');
	const corrupted = encoded.output.slice();
	corrupted[corrupted.byteLength - 1] ^= 1;
	assert.equal((await runtime.preflightRequest?.(decodeRequest(corrupted), {
		operation: deriveDesktopAudioCodecOperation(decodeRequest(corrupted)),
	}))?.disposition, 'rejected');
});

test('runtime makes malformed PCM/Ogg, output bounds, and cancellation terminal', async () => {
	const runtime = await requiredRuntime('mac-arm64');
	const invalidPcm = await execute(runtime, encodeRequest(floatBytes([0, Number.NaN]), {
		frameCount: 1, channelCount: 2, sampleRate: 48_000, quality: 5,
	}));
	assert.equal(invalidPcm.status, 'failed');
	if (invalidPcm.status === 'failed') assert.equal(invalidPcm.reason, 'security-failed');
	const encoded = await execute(runtime, encodeRequest(sinePcm(960, 1, 48_000), {
		frameCount: 960, channelCount: 1, sampleRate: 48_000, quality: 5,
	}));
	assert.equal(encoded.status, 'executed');
	if (encoded.status !== 'executed') return;
	const tooSmall = await execute(runtime, { ...decodeRequest(encoded.output), maximumOutputBytes: 3_839 });
	assert.equal(tooSmall.status, 'failed');
	if (tooSmall.status === 'failed') assert.equal(tooSmall.reason, 'result-failed');
	const controller = new AbortController();
	controller.abort(new Error('stop-vorbis'));
	await assert.rejects(runtime.execute(encodeRequest(sinePcm(960, 1, 48_000), {
		frameCount: 960, channelCount: 1, sampleRate: 48_000, quality: 5,
	}), {
		operation: deriveDesktopAudioCodecOperation(encodeRequest(sinePcm(960, 1, 48_000), {
			frameCount: 960, channelCount: 1, sampleRate: 48_000, quality: 5,
		})), signal: controller.signal,
	}), /stop-vorbis/u);
});

async function requiredRuntime(target: 'linux-x64' | 'mac-arm64' | 'win-arm64') {
	const runtime = await loadBundledVorbisAudioCodecRuntime({ target });
	assert.ok(runtime);
	return runtime;
}

async function execute(runtime: DesktopAudioCodecProviderRuntime, request: DesktopAudioCodecRequest) {
	return await runtime.execute(request, {
		operation: deriveDesktopAudioCodecOperation(request),
	}) as DesktopAudioCodecProviderExecutionResult;
}

function encodeRequest(input: Uint8Array, options: Readonly<{
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly quality: number;
}>): DesktopAudioCodecRequest {
	return Object.freeze({
		operation: 'audio-encode', format: 'ogg-vorbis', input,
		sampleRate: options.sampleRate, channelCount: options.channelCount,
		settings: Object.freeze({ quality: options.quality }), maximumOutputBytes: 2 * 1024 * 1024,
	});
}

function decodeRequest(input: Uint8Array): DesktopAudioCodecRequest {
	return Object.freeze({
		operation: 'audio-decode', format: 'ogg-vorbis', input,
		sampleRate: null, channelCount: null, settings: Object.freeze({ sampleFormat: 'f32le' }),
		maximumOutputBytes: 2 * 1024 * 1024,
	});
}

function sinePcm(frameCount: number, channelCount: number, sampleRate: number): Uint8Array {
	const values = new Float32Array(frameCount * channelCount);
	for (let frame = 0; frame < frameCount; frame++) for (let channel = 0; channel < channelCount; channel++) {
		values[frame * channelCount + channel]
			= Math.sin(2 * Math.PI * (220 + 110 * channel) * frame / sampleRate) * 0.35;
	}
	return new Uint8Array(values.buffer);
}

function snr(expectedBytes: Uint8Array, actualBytes: Uint8Array): number {
	const expected = new Float32Array(expectedBytes.buffer, expectedBytes.byteOffset, expectedBytes.byteLength / 4);
	const actual = new Float32Array(actualBytes.buffer, actualBytes.byteOffset, actualBytes.byteLength / 4);
	assert.equal(actual.length, expected.length);
	let signal = 0;
	let error = 0;
	for (let index = 0; index < expected.length; index++) {
		assert.equal(Number.isFinite(actual[index]), true);
		signal += expected[index]! ** 2;
		error += (expected[index]! - actual[index]!) ** 2;
	}
	return 10 * Math.log10(signal / error);
}

function floatBytes(values: readonly number[]): Uint8Array {
	return new Uint8Array(Float32Array.from(values).buffer);
}

function concatBytes(...values: readonly Uint8Array[]): Uint8Array {
	const output = new Uint8Array(values.reduce((total, value) => total + value.byteLength, 0));
	let offset = 0;
	for (const value of values) { output.set(value, offset); offset += value.byteLength; }
	return output;
}

function oggPageLengthAt(stream: Uint8Array, offset: number): number {
	const segments = stream[offset + 26];
	let body = 0;
	for (let index = 0; index < segments; index++) body += stream[offset + 27 + index];
	return 27 + segments + body;
}

function oggPacketByteLocation(
	stream: Uint8Array,
	targetPacket: number,
	targetByte: number,
): Readonly<{ readonly byteOffset: number; readonly pageOffset: number; readonly pageLength: number }> {
	let pageOffset = 0;
	let packet = 0;
	let packetBytes = 0;
	while (pageOffset < stream.byteLength) {
		const segments = stream[pageOffset + 26];
		let bodyOffset = pageOffset + 27 + segments;
		for (let index = 0; index < segments; index++) {
			const segmentBytes = stream[pageOffset + 27 + index];
			if (packet === targetPacket && targetByte >= packetBytes
				&& targetByte < packetBytes + segmentBytes) return Object.freeze({
				byteOffset: bodyOffset + targetByte - packetBytes, pageOffset,
				pageLength: oggPageLengthAt(stream, pageOffset),
			});
			bodyOffset += segmentBytes;
			packetBytes += segmentBytes;
			if (segmentBytes < 255) { packet++; packetBytes = 0; }
		}
		pageOffset += oggPageLengthAt(stream, pageOffset);
	}
	throw new Error('The requested Ogg packet byte is unavailable.');
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
