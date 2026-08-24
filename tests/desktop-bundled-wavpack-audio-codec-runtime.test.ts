/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	BUNDLED_WAVPACK_COMPRESSION_LEVEL,
	BUNDLED_WAVPACK_WASM_BYTE_LENGTH,
	BUNDLED_WAVPACK_WASM_SHA256,
	loadBundledWavPackAudioCodecRuntime,
} from '../desktop/bundled-wavpack-audio-codec-runtime.ts';
import {
	assembleBundledWavPackChunks,
	parseBundledWavPackStream,
} from '../desktop/bundled-wavpack-stream.ts';
import type {
	DesktopAudioCodecProviderExecutionResult,
} from '../desktop/desktop-audio-codec-broker.ts';
import type {
	DesktopAudioCodecRequest,
} from '../desktop/desktop-audio-codec-operation-contract.ts';
import type { DesktopCodecOperation } from '../src/common/editor/desktop-codec-coordinator.ts';
import { loadWavPackWasm } from '../src/common/editor/wavpack/runtime.js';

const WASM_URL = new URL('../src/common/editor/wavpack/wavpack.wasm', import.meta.url);

test('the reviewed artifact emits a public WavPack stream with parsed source geometry', async () => {
	const bytes = await readFile(WASM_URL);
	assert.equal(bytes.byteLength, BUNDLED_WAVPACK_WASM_BYTE_LENGTH);
	const loadReviewedWasm = loadWavPackWasm as unknown as (
		value: Uint8Array,
	) => Promise<Awaited<ReturnType<typeof loadWavPackWasm>>>;
	const runtime = await loadReviewedWasm(bytes);
	const frames = 4_096;
	const planar = structuredPlanar(frames, 3);
	const encoded = runtime.encode(planar.buffer, {
		frames, channelCount: 3, sampleRate: 176_400,
		maximumOutputBytes: planar.byteLength,
	});
	assert.ok(encoded instanceof ArrayBuffer);
	assert.equal(Buffer.from(encoded, 0, 4).toString('ascii'), 'wvpk');
	const geometry = parseBundledWavPackStream(new Uint8Array(encoded));
	assert.deepEqual({
		sampleRate: geometry.sampleRate,
		channelCount: geometry.channelCount,
		frameCount: geometry.frameCount,
	}, { sampleRate: 176_400, channelCount: 3, frameCount: frames });
	assert.equal(geometry.groups.length, 1);
});

test('the exact staged payload gates a five-target bundled WavPack provider', async () => {
	const runtime = await loadBundledWavPackAudioCodecRuntime({ target: 'linux-x64' });
	assert.ok(runtime);
	assert.equal(runtime.provider.kind, 'bundled');
	assert.equal(runtime.provider.implementation, 'wavpack-wasm-f32');
	assert.match(runtime.provider.capabilityGeneration, new RegExp(BUNDLED_WAVPACK_WASM_SHA256, 'u'));
	assert.deepEqual(await runtime.provider.preflight(operation(), {}), {
		disposition: 'supported', reason: null,
	});
	assert.equal((await runtime.provider.preflight(operation({ codec: 'flac', container: 'flac' }), {})).disposition,
		'unsupported');
	assert.equal((await runtime.provider.preflight(operation({ sampleFormat: 's24' }), {})).disposition,
		'unsupported');
	assert.equal(await loadBundledWavPackAudioCodecRuntime({
		target: 'linux-x64', readPayload: async () => Uint8Array.of(0, 97, 115, 109),
	}), null);
	await assert.rejects(loadBundledWavPackAudioCodecRuntime({
		target: 'mac-x64' as 'mac-arm64',
	}), /target/iu);
	assert.equal(BUNDLED_WAVPACK_COMPRESSION_LEVEL, 2);
	const unsupportedLevel = await execute(runtime, {
		...encodeRequest(structuredInterleaved(16, 2), 16, 2),
		settings: Object.freeze({ compressionLevel: 1 }),
	});
	assert.deepEqual(unsupportedLevel, {
		status: 'failed', reason: 'unavailable',
		detail: 'The bundled WavPack provider supports only compression level 2 (reviewed fast mode).',
	});
});

test('the bundled provider encodes and decodes multi-block interleaved float PCM losslessly', async () => {
	const runtime = await loadBundledWavPackAudioCodecRuntime({ target: 'win-arm64' });
	assert.ok(runtime);
	const frameCount = 65_536 + 257;
	const channelCount = 3;
	const input = structuredInterleaved(frameCount, channelCount);
	const encoded = await execute(runtime, encodeRequest(input, frameCount, channelCount));
	assert.equal(encoded.status, 'executed');
	if (encoded.status !== 'executed') return;
	const geometry = parseBundledWavPackStream(encoded.output);
	assert.equal(geometry.frameCount, frameCount);
	assert.equal(geometry.channelCount, channelCount);
	assert.equal(geometry.sampleRate, 48_000);
	assert.equal(geometry.groups.length, 2);
	assert.deepEqual(geometry.groups.map(({ blockIndex }) => blockIndex), [0, 65_536]);
	assert.equal(geometry.groups.flatMap(({ blocks }) => blocks)
		.every(({ totalFrames }) => totalFrames === frameCount), true);
	assert.equal(geometry.groups.flatMap(({ blocks }) => blocks)
		.flatMap(({ metadataIds }) => metadataIds).filter((id) => id === 0x21).length, 1);
	assert.equal(geometry.groups.slice(1).flatMap(({ blocks }) => blocks)
		.some(({ metadataIds }) => metadataIds.includes(0x21)), false);

	const decoded = await execute(runtime, decodeRequest(encoded.output, frameCount, channelCount));
	assert.equal(decoded.status, 'executed');
	if (decoded.status !== 'executed') return;
	assert.deepEqual(new Uint32Array(decoded.output.buffer), new Uint32Array(input.buffer));
});

test('the stream authority rejects non-profile flags, correction data, extensions, and checksum faults', async () => {
	const loaded = loadWavPackWasm as unknown as (
		value: Uint8Array,
	) => Promise<Awaited<ReturnType<typeof loadWavPackWasm>>>;
	const codec = await loaded(await readFile(WASM_URL));
	const planar = structuredPlanar(4_096, 2);
	const source = new Uint8Array(codec.encode(planar.buffer, {
		frames: 4_096, channelCount: 2, sampleRate: 48_000,
		maximumOutputBytes: planar.byteLength,
	}) as ArrayBuffer);

	for (const flag of [0x8, 0x8000_0000]) {
		const mutated = source.slice();
		const view = new DataView(mutated.buffer);
		view.setUint32(24, view.getUint32(24, true) | flag, true);
		assert.throws(() => parseBundledWavPackStream(mutated), /unsupported float PCM/iu);
	}
	const integer = source.slice();
	const integerView = new DataView(integer.buffer);
	integerView.setUint32(24, integerView.getUint32(24, true) & ~0x80, true);
	assert.throws(() => parseBundledWavPackStream(integer), /unsupported float PCM/iu);

	const correction = source.slice();
	const primaryBitstream = metadata(correction, 0x0a);
	correction[primaryBitstream.headerOffset] = (
		correction[primaryBitstream.headerOffset]! & 0xc0
	) | 0x0b;
	assert.throws(() => parseBundledWavPackStream(correction), /outside the reviewed/iu);

	const extension = source.slice();
	const config = metadata(extension, 0x25);
	extension[config.headerOffset] = (extension[config.headerOffset]! & 0xc0) | 0x3e;
	assert.throws(() => parseBundledWavPackStream(extension), /outside the reviewed/iu);

	const checksumFault = source.slice();
	const checksum = metadata(checksumFault, 0x2f);
	checksumFault[checksum.dataOffset + checksum.dataLength - 1] ^= 1;
	assert.throws(() => parseBundledWavPackStream(checksumFault), /checksum failed/iu);

	const noChecksum = source.slice();
	const noChecksumView = new DataView(noChecksum.buffer);
	noChecksumView.setUint32(24, noChecksumView.getUint32(24, true) & ~0x1000_0000, true);
	assert.throws(() => parseBundledWavPackStream(noChecksum), /checksum declaration/iu);

	const outOfBounds = source.slice();
	new DataView(outOfBounds.buffer).setUint32(4, outOfBounds.byteLength, true);
	assert.throws(() => parseBundledWavPackStream(outOfBounds), /size exceeds/iu);
});

test('assembly strips chunk-scoped MD5 records and refuses ambiguous RIFF trailers', async () => {
	const loaded = loadWavPackWasm as unknown as (
		value: Uint8Array,
	) => Promise<Awaited<ReturnType<typeof loadWavPackWasm>>>;
	const codec = await loaded(await readFile(WASM_URL));
	const frames = 4_096;
	const planar = structuredPlanar(frames, 2);
	const source = new Uint8Array(codec.encode(planar.buffer, {
		frames, channelCount: 2, sampleRate: 48_000,
		maximumOutputBytes: planar.byteLength,
	}) as ArrayBuffer);
	const withMd5 = insertMetadataBeforeBlockChecksum(source, 0x26, new Uint8Array(16).fill(0xa5));
	assert.equal(parseBundledWavPackStream(withMd5).groups[0]!.blocks[0]!.metadataIds.includes(0x26), true);
	const assembled = assembleBundledWavPackChunks({
		chunks: [withMd5], sampleRate: 48_000, channelCount: 2, frameCount: frames,
		maximumOutputBytes: planar.byteLength,
	});
	assert.equal(parseBundledWavPackStream(assembled).groups[0]!.blocks[0]!.metadataIds.includes(0x26), false);

	const withTrailer = insertMetadataBeforeBlockChecksum(source, 0x22, new Uint8Array());
	assert.equal(parseBundledWavPackStream(withTrailer).groups[0]!.blocks[0]!.metadataIds.includes(0x22), true);
	assert.throws(() => assembleBundledWavPackChunks({
		chunks: [withTrailer], sampleRate: 48_000, channelCount: 2, frameCount: frames,
		maximumOutputBytes: planar.byteLength,
	}), /trailer cannot be preserved/iu);

	const duplicateTrailer = insertMetadataBeforeBlockChecksum(withTrailer, 0x22, new Uint8Array());
	assert.throws(() => parseBundledWavPackStream(duplicateTrailer), /trailer/iu);
});

test('decode trusts parsed WavPack geometry, enforces output bounds, and fails closed', async () => {
	const runtime = await loadBundledWavPackAudioCodecRuntime({ target: 'mac-arm64' });
	assert.ok(runtime);
	const frameCount = 8_192;
	const input = structuredInterleaved(frameCount, 2);
	const encoded = await execute(runtime, encodeRequest(input, frameCount, 2));
	assert.equal(encoded.status, 'executed');
	if (encoded.status !== 'executed') return;

	const wrongGeometry = await execute(runtime, decodeRequest(encoded.output, frameCount, 1));
	assert.deepEqual(wrongGeometry, {
		status: 'failed', reason: 'security-failed',
		detail: 'The WavPack source geometry does not match the decode request.',
	});
	const tooSmall = await execute(runtime, {
		...decodeRequest(encoded.output, frameCount, 2), maximumOutputBytes: input.byteLength - 1,
	});
	assert.deepEqual(tooSmall, {
		status: 'failed', reason: 'result-failed',
		detail: 'The decoded WavPack PCM exceeds the requested output bound.',
	});
	const truncated = await execute(runtime, decodeRequest(encoded.output.subarray(0, encoded.output.byteLength - 1), frameCount, 2));
	assert.equal(truncated.status, 'failed');
	if (truncated.status === 'failed') assert.equal(truncated.reason, 'security-failed');
});

test('high-entropy float bits encode without a raw-size assumption and honor the aggregate bound', async () => {
	const runtime = await loadBundledWavPackAudioCodecRuntime({ target: 'win-x64' });
	assert.ok(runtime);
	const frameCount = 65_536 + 17;
	const words = new Uint32Array(frameCount);
	let state = 0x9e37_79b9;
	for (let index = 0; index < words.length; index += 1) {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		words[index] = state >>> 0;
	}
	const input = new Uint8Array(words.buffer);
	const request = encodeRequest(input, frameCount, 1);
	const encoded = await execute(runtime, request);
	assert.equal(encoded.status, 'executed');
	if (encoded.status !== 'executed') return;
	assert.ok(encoded.output.byteLength > input.byteLength,
		'the fixture exercises WavPack expansion beyond raw PCM');
	const decoded = await execute(runtime, decodeRequest(encoded.output, frameCount, 1));
	assert.equal(decoded.status, 'executed');
	if (decoded.status === 'executed') {
		assert.deepEqual(new Uint32Array(decoded.output.buffer), words);
	}
	const bounded = await execute(runtime, {
		...request, maximumOutputBytes: encoded.output.byteLength - 1,
	});
	assert.deepEqual(bounded, {
		status: 'failed', reason: 'result-failed',
		detail: 'The encoded WavPack stream exceeds the requested output bound.',
	});
});

test('multi-block execution yields to cancellation and never returns partial bytes', async () => {
	const controller = new AbortController();
	let yields = 0;
	const runtime = await loadBundledWavPackAudioCodecRuntime({
		target: 'linux-arm64',
		yieldControl: () => {
			yields += 1;
			controller.abort(new DOMException('cancelled', 'AbortError'));
			return Promise.resolve();
		},
	});
	assert.ok(runtime);
	const frames = 65_536 + 1;
	await assert.rejects(runtime.execute(encodeRequest(structuredInterleaved(frames, 1), frames, 1), {
		operation: operation({ channelCount: 1 }), signal: controller.signal,
	}), { name: 'AbortError' });
	assert.equal(yields, 1);
});

async function execute(
	runtime: NonNullable<Awaited<ReturnType<typeof loadBundledWavPackAudioCodecRuntime>>>,
	request: DesktopAudioCodecRequest,
): Promise<DesktopAudioCodecProviderExecutionResult> {
	return await runtime.execute(request, { operation: operation({
		direction: request.operation === 'audio-encode' ? 'encode' : 'decode',
		sampleRate: request.sampleRate, channelCount: request.channelCount,
	}) }) as DesktopAudioCodecProviderExecutionResult;
}

function encodeRequest(
	input: Uint8Array,
	frameCount: number,
	channelCount: number,
): Extract<DesktopAudioCodecRequest, {
	readonly operation: 'audio-encode'; readonly format: 'wavpack';
}> {
	assert.equal(input.byteLength, frameCount * channelCount * 4);
	return Object.freeze({
		operation: 'audio-encode' as const, format: 'wavpack' as const, input,
		sampleRate: 48_000, channelCount, settings: Object.freeze({ compressionLevel: 2 }),
		maximumOutputBytes: 128 * 1024 * 1024, requestId: 'bundled-wavpack-encode',
	});
}

function decodeRequest(
	input: Uint8Array,
	frameCount: number,
	channelCount: number,
): Extract<DesktopAudioCodecRequest, { readonly operation: 'audio-decode' }> {
	assert.ok(frameCount > 0);
	return Object.freeze({
		operation: 'audio-decode' as const, format: 'wavpack' as const, input,
		sampleRate: 48_000, channelCount, settings: Object.freeze({ sampleFormat: 'f32le' as const }),
		maximumOutputBytes: 128 * 1024 * 1024, requestId: 'bundled-wavpack-decode',
	});
}

function operation(overrides: Partial<DesktopCodecOperation> = {}): DesktopCodecOperation {
	return Object.freeze({
		direction: 'encode', mediaKind: 'audio', container: 'wavpack', codec: 'wavpack',
		profile: null, sampleFormat: 'f32', pixelFormat: null, sampleRate: 48_000,
		channelCount: 2, width: null, height: null, ...overrides,
	});
}

function structuredPlanar(frameCount: number, channelCount: number): Float32Array {
	const samples = new Float32Array(frameCount * channelCount);
	for (let channel = 0; channel < channelCount; channel += 1) {
		for (let frame = 0; frame < frameCount; frame += 1) {
			samples[channel * frameCount + frame] = Math.sin((frame + channel * 17) / 31) * 0.75;
		}
	}
	return samples;
}

function structuredInterleaved(frameCount: number, channelCount: number): Uint8Array {
	const samples = new Float32Array(frameCount * channelCount);
	for (let frame = 0; frame < frameCount; frame += 1) {
		for (let channel = 0; channel < channelCount; channel += 1) {
			samples[frame * channelCount + channel] = Math.sin((frame + channel * 17) / 31) * 0.75;
		}
	}
	return new Uint8Array(samples.buffer);
}

function metadata(input: Uint8Array, expectedId: number): Readonly<{
	readonly headerOffset: number; readonly dataOffset: number; readonly dataLength: number;
}> {
	const blockEnd = new DataView(input.buffer, input.byteOffset, input.byteLength).getUint32(4, true) + 8;
	let offset = 32;
	while (offset < blockEnd) {
		const headerOffset = offset;
		const rawId = input[offset++]!;
		let words = input[offset++]!;
		if (rawId & 0x80) {
			words += input[offset++]! << 8;
			words += input[offset++]! << 16;
		}
		const storedBytes = words * 2;
		const dataLength = storedBytes - (rawId & 0x40 ? 1 : 0);
		if ((rawId & 0x3f) === expectedId) return Object.freeze({ headerOffset, dataOffset: offset, dataLength });
		offset += storedBytes;
	}
	throw new Error(`Missing WavPack metadata ${String(expectedId)}.`);
}

function insertMetadataBeforeBlockChecksum(
	input: Uint8Array,
	id: number,
	data: Uint8Array,
): Uint8Array {
	assert.ok(id >= 0 && id <= 0x3f && data.byteLength <= 0x1fe);
	const checksum = metadata(input, 0x2f);
	const storedBytes = data.byteLength + (data.byteLength & 1);
	const record = new Uint8Array(2 + storedBytes);
	record[0] = id | (data.byteLength & 1 ? 0x40 : 0);
	record[1] = storedBytes / 2;
	record.set(data, 2);
	const output = new Uint8Array(input.byteLength + record.byteLength);
	output.set(input.subarray(0, checksum.headerOffset), 0);
	output.set(record, checksum.headerOffset);
	output.set(input.subarray(checksum.headerOffset), checksum.headerOffset + record.byteLength);
	const view = new DataView(output.buffer);
	view.setUint32(4, view.getUint32(4, true) + record.byteLength, true);
	refreshBlockChecksum(output);
	return output;
}

function refreshBlockChecksum(input: Uint8Array): void {
	const checksum = metadata(input, 0x2f);
	assert.equal(checksum.dataLength, 4);
	let value = 0xffff_ffff;
	for (let offset = 0; offset < checksum.headerOffset; offset += 2) {
		value = (Math.imul(value, 3) + input[offset]! + (input[offset + 1]! << 8)) >>> 0;
	}
	for (let index = 0; index < checksum.dataLength; index += 1) {
		input[checksum.dataOffset + index] = value & 0xff;
		value >>>= 8;
	}
}
