/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BUNDLED_OPUS_SAMPLE_RATE,
	BUNDLED_OPUS_WASM_BYTE_LENGTH,
	BUNDLED_OPUS_WASM_SHA256,
	loadBundledOpusAudioCodecRuntime,
} from '../desktop/bundled-opus-audio-codec-runtime.ts';
import { createBundledDesktopAudioCodecRuntime } from '../desktop/bundled-audio-codec-runtime.ts';
import { parseBundledOpusStream } from '../desktop/bundled-opus-stream.ts';
import { createDesktopAudioCodecRuntimeComposition } from '../desktop/desktop-audio-codec-runtime-composition.ts';
import { deriveDesktopAudioCodecOperation } from '../desktop/desktop-audio-codec-broker.ts';
import type {
	DesktopAudioCodecProviderExecutionResult,
	DesktopAudioCodecProviderRuntime,
} from '../desktop/desktop-audio-codec-broker.ts';
import type { DesktopAudioCodecRequest } from '../desktop/desktop-audio-codec-operation-contract.ts';
import { DESKTOP_CODEC_TARGETS } from '../src/common/editor/desktop-codec-provider-catalog.ts';

test('the exact artifact gates a narrow Ogg Opus provider on all five targets', async () => {
	for (const target of DESKTOP_CODEC_TARGETS) {
		const runtime = await loadBundledOpusAudioCodecRuntime({ target });
		assert.ok(runtime, target);
		assert.equal(runtime.provider.kind, 'bundled');
		assert.equal(runtime.provider.implementation, 'libopus-libogg-wasm-f32');
		assert.match(runtime.provider.capabilityGeneration, new RegExp(BUNDLED_OPUS_WASM_SHA256, 'u'));
	}
	assert.equal(BUNDLED_OPUS_SAMPLE_RATE, 48_000);
	assert.equal(BUNDLED_OPUS_WASM_BYTE_LENGTH, 385_789);
	assert.equal(await loadBundledOpusAudioCodecRuntime({
		target: 'win-x64', readPayload: async () => new Uint8Array(BUNDLED_OPUS_WASM_BYTE_LENGTH),
	}), null);
	await assert.rejects(loadBundledOpusAudioCodecRuntime({
		target: 'mac-x64' as 'mac-arm64',
	}), /target/iu);
});

test('UI-facing capability status exposes only the reviewed 48 kHz mono/stereo Opus tuple', async () => {
	const opus = await requiredRuntime('linux-x64');
	const bundled = createBundledDesktopAudioCodecRuntime({
		target: 'linux-x64', runtimes: [opus],
	});
	const service = createDesktopAudioCodecRuntimeComposition({
		target: 'linux-x64', scratchRoot: '/private/soundscaper-opus',
		createBundledRuntime: () => bundled,
		externalFfmpegPreferences: Object.freeze({
			admission: () => null,
			invalidateAdmission: async () => Object.freeze({
				state: 'quarantined' as const, location: null, version: null, detail: '',
				canInstall: false, canBrowse: true, canClear: false,
			}),
		}),
	});
	const operations = [
		{ operation: 'audio-encode' as const, format: 'opus' as const, sampleRate: 48_000, channelCount: 2 },
		{ operation: 'audio-encode' as const, format: 'opus' as const, sampleRate: 24_000, channelCount: 2 },
		{ operation: 'audio-encode' as const, format: 'opus' as const, sampleRate: 48_000, channelCount: 3 },
	];
	const result = await service.capabilities({ schemaVersion: 1, operations });
	assert.deepEqual(result.capabilities.map(({ available, provider, reason }) => ({
		available, provider, reason,
	})), [
		{ available: true, provider: 'bundled', reason: null },
		{ available: false, provider: null, reason: 'configure-external-ffmpeg' },
		{ available: false, provider: null, reason: 'configure-external-ffmpeg' },
	]);
});

test('reviewed Opus encoding preserves frame geometry through pre-skip and EOS granule trim', async () => {
	const runtime = await requiredRuntime('linux-x64');
	const source = sinePcm(4_800, 2);
	const encoded = await execute(runtime, encodeRequest(source, 2, 128));
	assert.equal(encoded.status, 'executed');
	if (encoded.status !== 'executed') return;
	assert.equal(Buffer.from(encoded.output.subarray(0, 4)).toString('ascii'), 'OggS');
	assert.deepEqual(parseBundledOpusStream(encoded.output), {
		sampleRate: 48_000, channelCount: 2, frameCount: 4_800, preSkip: 312,
		audioPacketCount: 6,
	});
	const decoded = await execute(runtime, decodeRequest(encoded.output));
	assert.equal(decoded.status, 'executed');
	if (decoded.status !== 'executed') return;
	assert.deepEqual(decoded.decodedGeometry, {
		sampleRate: 48_000, channelCount: 2, frameCount: 4_800,
	});
	assert.ok(snr(source, decoded.output) > 20);
	for (const bitrate of [16, 256]) {
		const boundary = await execute(runtime, encodeRequest(sinePcm(960, 1), 1, bitrate));
		assert.equal(boundary.status, 'executed', `${String(bitrate)} kbit/s`);
		if (boundary.status === 'executed') assert.equal(
			parseBundledOpusStream(boundary.output).frameCount, 960,
		);
	}
});

test('the exact request gate falls through only for valid unreviewed Opus profiles', async () => {
	const runtime = await requiredRuntime('win-arm64');
	const mono = sinePcm(960, 1);
	const wrongRate = encodeRequest(mono, 1, 64, 24_000);
	assert.deepEqual(await runtime.preflightRequest?.(wrongRate, {
		operation: deriveDesktopAudioCodecOperation(wrongRate),
	}), {
		disposition: 'unsupported', reason: 'The bundled Opus provider requires 48 kHz mono or stereo PCM.',
	});
	const wrongChannels = encodeRequest(sinePcm(960, 3), 3, 128);
	assert.equal((await runtime.preflightRequest?.(wrongChannels, {
		operation: deriveDesktopAudioCodecOperation(wrongChannels),
	}))?.disposition, 'unsupported');
	const encoded = await execute(runtime, encodeRequest(mono, 1, 64));
	assert.equal(encoded.status, 'executed');
	if (encoded.status !== 'executed') return;
	const gained = withOutputGain(encoded.output, 256);
	assert.equal((await runtime.preflightRequest?.(decodeRequest(gained), {
		operation: deriveDesktopAudioCodecOperation(decodeRequest(gained)),
	}))?.disposition, 'unsupported');
	const corrupted = gained.slice();
	corrupted[corrupted.byteLength - 1] ^= 1;
	assert.equal((await runtime.preflightRequest?.(decodeRequest(corrupted), {
		operation: deriveDesktopAudioCodecOperation(decodeRequest(corrupted)),
	}))?.disposition, 'rejected');
});

test('runtime makes malformed PCM/Ogg and output-bound failures terminal', async () => {
	const runtime = await requiredRuntime('mac-arm64');
	const nonFinite = floatBytes([0, Number.NaN]);
	const badPcm = await execute(runtime, encodeRequest(nonFinite, 2, 64));
	assert.equal(badPcm.status, 'failed');
	if (badPcm.status === 'failed') assert.equal(badPcm.reason, 'security-failed');
	const encoded = await execute(runtime, encodeRequest(sinePcm(960, 1), 1, 64));
	assert.equal(encoded.status, 'executed');
	if (encoded.status !== 'executed') return;
	const tooSmall = await execute(runtime, { ...decodeRequest(encoded.output), maximumOutputBytes: 3_839 });
	assert.deepEqual(tooSmall, {
		status: 'failed', reason: 'result-failed',
		detail: 'The decoded Opus PCM exceeds the requested output bound.',
	});
	const corrupted = encoded.output.slice();
	corrupted[corrupted.byteLength - 1] ^= 1;
	const rejected = await execute(runtime, decodeRequest(corrupted));
	assert.equal(rejected.status, 'failed');
	if (rejected.status === 'failed') assert.equal(rejected.reason, 'security-failed');
});

test('an already-aborted operation never enters the reviewed Opus payload', async () => {
	const runtime = await requiredRuntime('win-x64');
	const controller = new AbortController();
	controller.abort(new Error('stop-opus'));
	await assert.rejects(runtime.execute(encodeRequest(sinePcm(960, 1), 1, 64), {
		operation: deriveDesktopAudioCodecOperation(encodeRequest(sinePcm(960, 1), 1, 64)),
		signal: controller.signal,
	}), /stop-opus/u);
});

async function requiredRuntime(target: 'linux-x64' | 'mac-arm64' | 'win-arm64' | 'win-x64') {
	const runtime = await loadBundledOpusAudioCodecRuntime({ target });
	assert.ok(runtime);
	return runtime;
}

async function execute(runtime: DesktopAudioCodecProviderRuntime, request: DesktopAudioCodecRequest) {
	return await runtime.execute(request, {
		operation: deriveDesktopAudioCodecOperation(request),
	}) as DesktopAudioCodecProviderExecutionResult;
}

function encodeRequest(
	input: Uint8Array, channelCount: number, bitrateKbps: number, sampleRate = 48_000,
): DesktopAudioCodecRequest {
	return Object.freeze({
		operation: 'audio-encode', format: 'opus', input, sampleRate, channelCount,
		settings: Object.freeze({ bitrateKbps }), maximumOutputBytes: 1024 * 1024,
		requestId: 'opus-encode',
	});
}

function decodeRequest(input: Uint8Array): DesktopAudioCodecRequest {
	return Object.freeze({
		operation: 'audio-decode', format: 'opus', input, sampleRate: null, channelCount: null,
		settings: Object.freeze({ sampleFormat: 'f32le' }), maximumOutputBytes: 1024 * 1024,
		requestId: 'opus-decode',
	});
}

function sinePcm(frameCount: number, channelCount: number): Uint8Array {
	const values = new Float32Array(frameCount * channelCount);
	for (let frame = 0; frame < frameCount; frame++) {
		for (let channel = 0; channel < channelCount; channel++) {
			values[frame * channelCount + channel]
				= Math.sin(2 * Math.PI * (440 + channel * 220) * frame / 48_000) * 0.35;
		}
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

function withOutputGain(stream: Uint8Array, gainQ8: number): Uint8Array {
	const result = stream.slice();
	const segments = result[26];
	const packetOffset = 27 + segments;
	new DataView(result.buffer).setInt16(packetOffset + 16, gainQ8, true);
	new DataView(result.buffer).setUint32(22, 0, true);
	new DataView(result.buffer).setUint32(22, oggCrc(result.subarray(0, firstPageLength(result))), true);
	return result;
}

function firstPageLength(stream: Uint8Array): number {
	const segments = stream[26];
	let body = 0;
	for (let index = 0; index < segments; index++) body += stream[27 + index];
	return 27 + segments + body;
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

function floatBytes(values: readonly number[]): Uint8Array {
	return new Uint8Array(Float32Array.from(values).buffer);
}
