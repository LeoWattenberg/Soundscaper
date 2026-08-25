/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BUNDLED_LAME_WASM_BYTE_LENGTH,
	BUNDLED_LAME_WASM_SHA256,
	loadBundledLameAudioCodecRuntime,
} from '../desktop/bundled-lame-audio-codec-runtime.ts';
import { loadBundledMpg123AudioCodecRuntime } from '../desktop/bundled-mpg123-audio-codec-runtime.ts';
import { deriveDesktopAudioCodecOperation } from '../desktop/desktop-audio-codec-broker.ts';
import type {
	DesktopAudioCodecProviderExecutionResult,
	DesktopAudioCodecProviderRuntime,
} from '../desktop/desktop-audio-codec-broker.ts';
import {
	desktopAudioCodecEncodeBitRates,
	type DesktopAudioCodecRequest,
} from '../desktop/desktop-audio-codec-operation-contract.ts';
import { parseBundledMpegAudioStream } from '../desktop/bundled-mpeg-audio-stream.ts';
import { DESKTOP_CODEC_TARGETS } from '../src/common/editor/desktop-codec-provider-catalog.ts';

test('the exact artifact gates a narrow LAME 4.0 encoder on all five targets', async () => {
	for (const target of DESKTOP_CODEC_TARGETS) {
		const runtime = await loadBundledLameAudioCodecRuntime({ target });
		assert.ok(runtime, target);
		assert.equal(runtime.provider.kind, 'bundled');
		assert.equal(runtime.provider.implementation, 'lame-wasm-f32-mp3');
		assert.match(runtime.provider.capabilityGeneration, new RegExp(BUNDLED_LAME_WASM_SHA256, 'u'));
	}
	assert.ok(BUNDLED_LAME_WASM_BYTE_LENGTH > 0);
	assert.equal(await loadBundledLameAudioCodecRuntime({
		target: 'win-x64', readPayload: async () => new Uint8Array(BUNDLED_LAME_WASM_BYTE_LENGTH),
	}), null);
	await assert.rejects(loadBundledLameAudioCodecRuntime({
		target: 'mac-x64' as 'mac-arm64',
	}), /target/iu);
});

test('LAME emits bounded CBR MP3 with exact Xing/LAME gapless geometry', async () => {
	const runtime = await requiredRuntime('linux-x64');
	for (const fixture of [
		{ sampleRate: 48_000, channelCount: 2, bitrateKbps: 192, frameCount: 4_801 },
		{ sampleRate: 44_100, channelCount: 1, bitrateKbps: 128, frameCount: 1_153 },
		{ sampleRate: 32_000, channelCount: 2, bitrateKbps: 96, frameCount: 577 },
	] as const) {
		const request = encodeRequest(fixture);
		const encoded = await execute(runtime, request);
		assert.equal(encoded.status, 'executed');
		if (encoded.status !== 'executed') continue;
		const stream = parseBundledMpegAudioStream(encoded.output, 'mp3');
		assert.equal(stream.format, 'mp3');
		assert.equal(stream.layer, 3);
		assert.equal(stream.sampleRate, fixture.sampleRate);
		assert.equal(stream.channelCount, fixture.channelCount);
		assert.equal(stream.frameCount, fixture.frameCount);
		assert.equal(stream.gapless, 'lame');
		assert.ok(stream.encoderDelay > 0);
		assert.ok(stream.endPadding >= 0);
	}
});

test('LAME output round-trips through the separately reviewed mpg123 decoder', async () => {
	const encoder = await requiredRuntime('linux-x64');
	const decoder = await loadBundledMpg123AudioCodecRuntime({ target: 'linux-x64' });
	assert.ok(decoder);
	const request = encodeRequest({
		sampleRate: 48_000, channelCount: 2, bitrateKbps: 192, frameCount: 4_801,
	});
	const encoded = await execute(encoder, request);
	assert.equal(encoded.status, 'executed');
	if (encoded.status !== 'executed') return;
	const decodeRequest: DesktopAudioCodecRequest = Object.freeze({
		operation: 'audio-decode', format: 'mp3', input: encoded.output,
		sampleRate: null, channelCount: null,
		settings: Object.freeze({ sampleFormat: 'f32le' }),
		maximumOutputBytes: 1024 * 1024, requestId: 'lame-mpg123-round-trip',
	});
	const decoded = await execute(decoder, decodeRequest);
	assert.equal(decoded.status, 'executed');
	if (decoded.status !== 'executed') return;
	assert.deepEqual(decoded.decodedGeometry, {
		sampleRate: 48_000, channelCount: 2, frameCount: 4_801,
	});
	const source = new Float32Array(
		request.input.buffer, request.input.byteOffset, request.input.byteLength / 4,
	);
	const restored = new Float32Array(
		decoded.output.buffer, decoded.output.byteOffset, decoded.output.byteLength / 4,
	);
	assert.equal(restored.length, source.length);
	let signalPower = 0;
	let errorPower = 0;
	for (let index = 0; index < source.length; index++) {
		signalPower += source[index]! ** 2;
		errorPower += (source[index]! - restored[index]!) ** 2;
	}
	assert.ok(10 * Math.log10(signalPower / errorPower) > 20);
});

test('every admitted MPEG-1 sample-rate, bitrate, and channel tuple is exact', async () => {
	const runtime = await requiredRuntime('linux-arm64');
	for (const sampleRate of [32_000, 44_100, 48_000]) {
		for (const channelCount of [1, 2]) {
			for (const bitrateKbps of desktopAudioCodecEncodeBitRates('mp3', sampleRate, channelCount)) {
				const request = encodeRequest({
					sampleRate, channelCount, bitrateKbps, frameCount: 1_152,
				});
				const encoded = await execute(runtime, request);
				const admitted = bitrateKbps >= minimumLameBitrate(sampleRate, channelCount);
				assert.equal(
					encoded.status, admitted ? 'executed' : 'failed',
					`${String(sampleRate)}/${String(channelCount)}/${String(bitrateKbps)}`,
				);
				if (!admitted) {
					if (encoded.status === 'failed') assert.equal(encoded.reason, 'unavailable');
					assert.equal((await runtime.preflightRequest?.(request, {
						operation: deriveDesktopAudioCodecOperation(request),
					}))?.disposition, 'unsupported');
					continue;
				}
				if (encoded.status !== 'executed') continue;
				const stream = parseBundledMpegAudioStream(encoded.output, 'mp3');
				assert.equal(stream.bitrateKbps, bitrateKbps);
				assert.equal(stream.frameCount, 1_152);
			}
		}
	}
});

test('the LAME request gate supports exact contract settings and falls through other operations', async () => {
	const runtime = await requiredRuntime('win-arm64');
	const request = encodeRequest({
		sampleRate: 44_100, channelCount: 2, bitrateKbps: 320, frameCount: 1_152,
	});
	assert.deepEqual(await runtime.preflightRequest?.(request, {
		operation: deriveDesktopAudioCodecOperation(request),
	}), { disposition: 'supported', reason: null });
	const flac: DesktopAudioCodecRequest = Object.freeze({
		operation: 'audio-encode', format: 'flac', input: request.input,
		sampleRate: request.sampleRate, channelCount: request.channelCount,
		settings: Object.freeze({ compressionLevel: 5, bitDepth: 24 }),
		maximumOutputBytes: request.maximumOutputBytes, requestId: 'lame-flac-mismatch',
	});
	assert.equal((await runtime.preflightRequest?.(flac, {
		operation: deriveDesktopAudioCodecOperation(flac),
	}))?.disposition, 'rejected');
	assert.equal((await runtime.provider.preflight({
		...deriveDesktopAudioCodecOperation(request), direction: 'decode', sampleFormat: 'f32',
	}, {})).disposition, 'unsupported');
	const mpeg2 = encodeRequest({
		sampleRate: 24_000, channelCount: 1, bitrateKbps: 64, frameCount: 576,
	});
	assert.equal((await runtime.provider.preflight(
		deriveDesktopAudioCodecOperation(mpeg2), {},
	)).disposition, 'unsupported');
});

test('non-finite PCM, short output bounds, and cancellation are terminal', async () => {
	const runtime = await requiredRuntime('mac-arm64');
	const invalid = encodeRequest({
		sampleRate: 48_000, channelCount: 1, bitrateKbps: 128, frameCount: 2,
		input: floatBytes([0, Number.NaN]),
	});
	const rejected = await execute(runtime, invalid);
	assert.equal(rejected.status, 'failed');
	if (rejected.status === 'failed') assert.equal(rejected.reason, 'security-failed');
	const bounded = encodeRequest({
		sampleRate: 48_000, channelCount: 2, bitrateKbps: 192, frameCount: 4_800,
		maximumOutputBytes: 128,
	});
	const tooSmall = await execute(runtime, bounded);
	assert.equal(tooSmall.status, 'failed');
	if (tooSmall.status === 'failed') assert.equal(tooSmall.reason, 'result-failed');
	const controller = new AbortController();
	controller.abort(new Error('stop-lame'));
	const ordinary = encodeRequest({
		sampleRate: 48_000, channelCount: 2, bitrateKbps: 192, frameCount: 1_152,
	});
	await assert.rejects(runtime.execute(ordinary, {
		operation: deriveDesktopAudioCodecOperation(ordinary), signal: controller.signal,
	}), /stop-lame/u);
});

async function requiredRuntime(
	target: 'linux-x64' | 'linux-arm64' | 'mac-arm64' | 'win-arm64' | 'win-x64',
): Promise<DesktopAudioCodecProviderRuntime> {
	const runtime = await loadBundledLameAudioCodecRuntime({ target });
	assert.ok(runtime);
	return runtime;
}

function minimumLameBitrate(sampleRate: number, channelCount: number): number {
	if (sampleRate === 32_000) return channelCount === 1 ? 40 : 48;
	if (sampleRate === 44_100 && channelCount === 1) return 56;
	return 64;
}

async function execute(runtime: DesktopAudioCodecProviderRuntime, request: DesktopAudioCodecRequest) {
	return await runtime.execute(request, {
		operation: deriveDesktopAudioCodecOperation(request),
	}) as DesktopAudioCodecProviderExecutionResult;
}

function encodeRequest(options: Readonly<{
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly bitrateKbps: number;
	readonly frameCount: number;
	readonly input?: Uint8Array;
	readonly maximumOutputBytes?: number;
}>): DesktopAudioCodecRequest {
	return Object.freeze({
		operation: 'audio-encode', format: 'mp3',
		input: options.input ?? sinePcm(options.frameCount, options.channelCount, options.sampleRate),
		sampleRate: options.sampleRate, channelCount: options.channelCount,
		settings: Object.freeze({ bitrateKbps: options.bitrateKbps }),
		maximumOutputBytes: options.maximumOutputBytes ?? 1024 * 1024,
		requestId: 'lame-encode',
	});
}

function sinePcm(frameCount: number, channelCount: number, sampleRate: number): Uint8Array {
	const values = new Float32Array(frameCount * channelCount);
	for (let frame = 0; frame < frameCount; frame++) {
		for (let channel = 0; channel < channelCount; channel++) {
			values[frame * channelCount + channel]
				= Math.sin(2 * Math.PI * (440 + channel * 220) * frame / sampleRate) * 0.35;
		}
	}
	return new Uint8Array(values.buffer);
}

function floatBytes(values: readonly number[]): Uint8Array {
	return new Uint8Array(Float32Array.from(values).buffer);
}
