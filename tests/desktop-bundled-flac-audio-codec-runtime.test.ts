/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BUNDLED_FLAC_PCM_BIT_DEPTH,
	BUNDLED_FLAC_WASM_BYTE_LENGTH,
	BUNDLED_FLAC_WASM_SHA256,
	loadBundledFlacAudioCodecRuntime,
} from '../desktop/bundled-flac-audio-codec-runtime.ts';
import {
	BundledFlacStreamError,
	parseBundledFlacStream,
} from '../desktop/bundled-flac-stream.ts';
import { deriveDesktopAudioCodecOperation } from '../desktop/desktop-audio-codec-broker.ts';
import type {
	DesktopAudioCodecProviderExecutionResult,
	DesktopAudioCodecProviderRuntime,
} from '../desktop/desktop-audio-codec-broker.ts';
import type { DesktopAudioCodecRequest } from '../desktop/desktop-audio-codec-operation-contract.ts';

test('the exact artifact gates a five-target signed-24 FLAC provider', async () => {
	const runtime = await loadBundledFlacAudioCodecRuntime({ target: 'linux-arm64' });
	assert.ok(runtime);
	assert.equal(runtime.provider.kind, 'bundled');
	assert.equal(runtime.provider.implementation, 'libflac-wasm-f32-to-s24');
	assert.match(runtime.provider.capabilityGeneration, new RegExp(BUNDLED_FLAC_WASM_SHA256, 'u'));
	assert.equal(BUNDLED_FLAC_WASM_BYTE_LENGTH, 153_076);
	assert.equal(BUNDLED_FLAC_PCM_BIT_DEPTH, 24);
	assert.equal((await runtime.provider.preflight(operation('encode'), {})).disposition, 'supported');
	assert.equal((await runtime.provider.preflight(operation('decode'), {})).disposition, 'supported');
	assert.equal((await runtime.provider.preflight({
		...operation('encode'), sampleFormat: 'f32',
	}, {})).disposition, 'unsupported');
	assert.equal(await loadBundledFlacAudioCodecRuntime({
		target: 'win-x64', readPayload: async () => new Uint8Array(BUNDLED_FLAC_WASM_BYTE_LENGTH),
	}), null);
	await assert.rejects(loadBundledFlacAudioCodecRuntime({
		target: 'mac-x64' as 'mac-arm64',
	}), /target/iu);
});

test('encode reports and preserves a lossless FLAC stream over explicit signed-24 quantization', async () => {
	const runtime = await requiredRuntime('mac-arm64');
	const source = floatBytes([-2, -1, -0.75, -1 / 8, 0, 1 / 8, 0.75, 1, 2]);
	const request = encodeRequest(source, 9, 1, 8);
	const encoded = await execute(runtime, request);
	assert.equal(encoded.status, 'executed');
	if (encoded.status !== 'executed') return;
	assert.equal(Buffer.from(encoded.output.subarray(0, 4)).toString('ascii'), 'fLaC');
	assert.deepEqual(parseBundledFlacStream(encoded.output), {
		blockCount: 2, metadataBytes: 86, frameCount: 9, channelCount: 1,
		sampleRate: 48_000, bitsPerSample: 24,
	});
	const decoded = await execute(runtime, decodeRequest(encoded.output, 1));
	assert.equal(decoded.status, 'executed');
	if (decoded.status !== 'executed') return;
	assert.deepEqual(decoded.decodedGeometry, {
		sampleRate: 48_000, channelCount: 1, frameCount: 9,
	});
	const values = floats(decoded.output);
	assert.deepEqual(values.map((value) => Math.round(value * 8_388_608)), [
		-8_388_608, -8_388_608, -6_291_456, -1_048_576, 0,
		1_048_576, 6_291_456, 8_388_607, 8_388_607,
	]);
});

/**
 * Rounding half away from zero carries past the signed-24 maximum for the
 * largest float below 1.0, which scales to exactly 8388607.5. The encoder is
 * configured for 24 bits and refuses an out-of-range sample, so one such value
 * used to fail the whole buffer rather than a single sample. Peak
 * normalization lands on it routinely.
 */
test('a peak just below full scale encodes instead of failing the whole buffer', async () => {
	const runtime = await requiredRuntime('linux-x64');
	const edge = Math.fround(1 - 2 ** -24);
	assert.ok(edge < 1, 'the fixture value is strictly below full scale');
	const source = floatBytes([0, edge, -edge, 0]);

	const encoded = await execute(runtime, encodeRequest(source, 4, 1, 5));
	assert.equal(encoded.status, 'executed');
	if (encoded.status !== 'executed') return;
	assert.equal(Buffer.from(encoded.output.subarray(0, 4)).toString('ascii'), 'fLaC');

	const decoded = await execute(runtime, decodeRequest(encoded.output, 1));
	assert.equal(decoded.status, 'executed');
	if (decoded.status !== 'executed') return;
	assert.deepEqual(
		floats(decoded.output).map((value) => Math.round(value * 8_388_608)),
		[0, 8_388_607, -8_388_608, 0],
		'the peak saturates to the signed-24 maximum rather than overflowing it',
	);
});

test('all reviewed compression levels round trip and other FLAC settings fail closed', async () => {
	const runtime = await requiredRuntime('win-arm64');
	const source = floatBytes(Array.from({ length: 257 * 2 }, (_, index) => (
		Math.sin(index / 17) * 0.8
	)));
	for (const compressionLevel of [0, 5, 8]) {
		const encoded = await execute(runtime, encodeRequest(source, 257, 2, compressionLevel));
		assert.equal(encoded.status, 'executed');
		if (encoded.status !== 'executed') continue;
		const decoded = await execute(runtime, decodeRequest(encoded.output, 2));
		assert.equal(decoded.status, 'executed');
		if (decoded.status !== 'executed') continue;
		const expected = floats(source);
		const actual = floats(decoded.output);
		assert.equal(actual.length, expected.length);
		for (let index = 0; index < actual.length; index += 1) {
			assert.ok(Math.abs(actual[index]! - expected[index]!) <= 2 ** -23);
		}
	}
	const wrongDepth = await runtime.execute({
		...encodeRequest(source, 257, 2, 5), settings: { compressionLevel: 5, bitDepth: 16 },
	} as DesktopAudioCodecRequest, { operation: operation('encode') }) as DesktopAudioCodecProviderExecutionResult;
	assert.deepEqual(wrongDepth, {
		status: 'failed', reason: 'unavailable',
		detail: 'The bundled FLAC provider supports only signed 24-bit PCM.',
	});
	assert.equal(typeof runtime.preflightRequest, 'function');
	const unreviewedLevel = encodeRequest(source, 257, 2, 9);
	assert.deepEqual(await runtime.preflightRequest?.(unreviewedLevel, {
		operation: deriveDesktopAudioCodecOperation(unreviewedLevel),
	}), {
		disposition: 'unsupported',
		reason: 'The bundled FLAC provider supports compression levels 0 through 8.',
	});
});

test('decode trusts bounded STREAMINFO geometry and rejects corruption', async () => {
	const runtime = await requiredRuntime('linux-x64');
	const encoded = await execute(runtime, encodeRequest(floatBytes([0.25, -0.5, 0.75, -1]), 2, 2, 5));
	assert.equal(encoded.status, 'executed');
	if (encoded.status !== 'executed') return;
	const sourceGeometry = await execute(runtime, decodeRequest(encoded.output, 1));
	assert.equal(sourceGeometry.status, 'executed');
	if (sourceGeometry.status === 'executed') assert.deepEqual(sourceGeometry.decodedGeometry, {
		sampleRate: 48_000, channelCount: 2, frameCount: 2,
	});
	const tooSmall = await execute(runtime, { ...decodeRequest(encoded.output, 2), maximumOutputBytes: 15 });
	assert.deepEqual(tooSmall, {
		status: 'failed', reason: 'result-failed',
		detail: 'The decoded FLAC PCM exceeds the requested output bound.',
	});
	const corrupted = encoded.output.slice();
	corrupted[corrupted.byteLength - 1] ^= 1;
	const rejected = await execute(runtime, decodeRequest(corrupted, 2));
	assert.equal(rejected.status, 'failed');
	if (rejected.status === 'failed') assert.equal(rejected.reason, 'security-failed');
});

test('the stream authority bounds metadata and rejects inexact FLAC headers', () => {
	assert.throws(() => parseBundledFlacStream(Uint8Array.of(0x66, 0x4c, 0x61)), BundledFlacStreamError);
	const source = streamInfoFixture();
	const duplicate = new Uint8Array(source.byteLength + 38);
	duplicate.set(source.subarray(0, 42));
	duplicate[4] = 0;
	duplicate.set(source.subarray(4, 42), 42);
	duplicate[42] = 0x80;
	duplicate.set(source.subarray(42), duplicate.byteLength - 1);
	assert.throws(() => parseBundledFlacStream(duplicate), /STREAMINFO/iu);
	const oversized = source.slice();
	oversized[5] = 0x10;
	assert.throws(() => parseBundledFlacStream(oversized), /metadata/iu);
});

test('an already-aborted operation never enters the reviewed payload', async () => {
	const runtime = await requiredRuntime('win-x64');
	const controller = new AbortController();
	controller.abort(new Error('stop-now'));
	await assert.rejects(runtime.execute(encodeRequest(floatBytes([0]), 1, 1, 5), {
		operation: operation('encode'), signal: controller.signal,
	}), /stop-now/u);
});

async function requiredRuntime(target: 'linux-x64' | 'mac-arm64' | 'win-arm64' | 'win-x64') {
	const runtime = await loadBundledFlacAudioCodecRuntime({ target });
	assert.ok(runtime);
	return runtime;
}

async function execute(runtime: DesktopAudioCodecProviderRuntime, request: DesktopAudioCodecRequest) {
	return await runtime.execute(request, {
		operation: deriveDesktopAudioCodecOperation(request),
	}) as DesktopAudioCodecProviderExecutionResult;
}

function encodeRequest(
	input: Uint8Array, frameCount: number, channelCount: number, compressionLevel: number,
): DesktopAudioCodecRequest {
	assert.equal(input.byteLength, frameCount * channelCount * 4);
	return Object.freeze({
		operation: 'audio-encode', format: 'flac', input, sampleRate: 48_000,
		channelCount, settings: Object.freeze({ compressionLevel, bitDepth: 24 }),
		maximumOutputBytes: 1024 * 1024, requestId: 'flac-encode',
	});
}

function decodeRequest(input: Uint8Array, channelCount: number): DesktopAudioCodecRequest {
	assert.ok(channelCount > 0);
	return Object.freeze({
		operation: 'audio-decode', format: 'flac', input, sampleRate: null,
		channelCount: null, settings: Object.freeze({ sampleFormat: 'f32le' }),
		maximumOutputBytes: 1024 * 1024, requestId: 'flac-decode',
	});
}

function operation(direction: 'decode' | 'encode') {
	return Object.freeze({
		direction, mediaKind: 'audio' as const, container: 'flac', codec: 'flac', profile: null,
		sampleFormat: direction === 'encode' ? 's24' : 'f32', pixelFormat: null,
		sampleRate: 48_000, channelCount: 2, width: null, height: null,
	});
}

function floatBytes(values: readonly number[]): Uint8Array {
	return new Uint8Array(Float32Array.from(values).buffer);
}

function floats(bytes: Uint8Array): number[] {
	return [...new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)];
}

function streamInfoFixture(): Uint8Array {
	const bytes = new Uint8Array(43);
	bytes.set([0x66, 0x4c, 0x61, 0x43, 0x80, 0, 0, 34]);
	const view = new DataView(bytes.buffer);
	view.setUint16(8, 16, false);
	view.setUint16(10, 16, false);
	const packed = (BigInt(48_000) << 44n) | (1n << 41n) | (23n << 36n) | 1n;
	view.setBigUint64(18, packed, false);
	bytes[42] = 0xff;
	return bytes;
}
