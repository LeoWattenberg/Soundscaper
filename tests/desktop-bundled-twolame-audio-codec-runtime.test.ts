/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BUNDLED_TWOLAME_WASM_BYTE_LENGTH,
	BUNDLED_TWOLAME_WASM_SHA256,
	loadBundledTwolameAudioCodecRuntime,
} from '../desktop/bundled-twolame-audio-codec-runtime.ts';
import { deriveDesktopAudioCodecOperation } from '../desktop/desktop-audio-codec-broker.ts';
import type {
	DesktopAudioCodecProviderExecutionResult,
	DesktopAudioCodecProviderRuntime,
} from '../desktop/desktop-audio-codec-broker.ts';
import type { DesktopAudioCodecRequest } from '../desktop/desktop-audio-codec-operation-contract.ts';
import { parseBundledMpegAudioStream } from '../desktop/bundled-mpeg-audio-stream.ts';
import { DESKTOP_CODEC_TARGETS } from '../src/common/editor/desktop-codec-provider-catalog.ts';

test('the exact artifact gates a narrow TwoLAME 0.4.0 encoder on all five targets', async () => {
	for (const target of DESKTOP_CODEC_TARGETS) {
		const runtime = await loadBundledTwolameAudioCodecRuntime({ target });
		assert.ok(runtime, target);
		assert.equal(runtime.provider.kind, 'bundled');
		assert.equal(runtime.provider.implementation, 'twolame-wasm-f32-mp2');
		assert.equal(runtime.provider.version, '0.4.0');
		assert.match(runtime.provider.capabilityGeneration, new RegExp(BUNDLED_TWOLAME_WASM_SHA256, 'u'));
	}
	assert.ok(BUNDLED_TWOLAME_WASM_BYTE_LENGTH > 0);
	assert.equal(await loadBundledTwolameAudioCodecRuntime({
		target: 'win-x64', readPayload: async () => new Uint8Array(BUNDLED_TWOLAME_WASM_BYTE_LENGTH),
	}), null);
	await assert.rejects(loadBundledTwolameAudioCodecRuntime({
		target: 'mac-x64' as 'mac-arm64',
	}), /target/iu);
});

test('TwoLAME emits strict MPEG-1 Layer II CBR with explicit whole-frame padding', async () => {
	const runtime = await requiredRuntime('linux-x64');
	for (const fixture of [
		{ sampleRate: 48_000, channelCount: 2, bitrateKbps: 384, frameCount: 4_801 },
		{ sampleRate: 44_100, channelCount: 1, bitrateKbps: 192, frameCount: 1_153 },
		{ sampleRate: 32_000, channelCount: 2, bitrateKbps: 64, frameCount: 577 },
	] as const) {
		const request = encodeRequest(fixture);
		const encoded = await execute(runtime, request);
		assert.equal(encoded.status, 'executed');
		if (encoded.status !== 'executed') continue;
		const stream = parseBundledMpegAudioStream(encoded.output, 'mp2');
		assert.equal(stream.format, 'mp2');
		assert.equal(stream.layer, 2);
		assert.equal(stream.mpegVersion, 1);
		assert.equal(stream.sampleRate, fixture.sampleRate);
		assert.equal(stream.channelCount, fixture.channelCount);
		assert.equal(stream.bitrateKbps, fixture.bitrateKbps);
		assert.equal(stream.frameCount, Math.ceil(fixture.frameCount / 1_152) * 1_152);
		assert.equal(stream.mpegFrameCount, Math.ceil(fixture.frameCount / 1_152));
		assert.equal(stream.gapless, 'none');
	}
});

test('TwoLAME exact request preflight falls through valid contract combinations it cannot encode', async () => {
	const runtime = await requiredRuntime('win-arm64');
	for (const fixture of [
		{ sampleRate: 32_000, channelCount: 1, bitrateKbps: 32 },
		{ sampleRate: 44_100, channelCount: 1, bitrateKbps: 192 },
		{ sampleRate: 48_000, channelCount: 2, bitrateKbps: 64 },
		{ sampleRate: 48_000, channelCount: 2, bitrateKbps: 384 },
	] as const) {
		const request = encodeRequest({ ...fixture, frameCount: 1_152 });
		assert.deepEqual(await runtime.preflightRequest?.(request, {
			operation: deriveDesktopAudioCodecOperation(request),
		}), { disposition: 'supported', reason: null });
	}
	for (const fixture of [
		{ channelCount: 1, bitrateKbps: 224 },
		{ channelCount: 1, bitrateKbps: 384 },
		{ channelCount: 2, bitrateKbps: 32 },
		{ channelCount: 2, bitrateKbps: 48 },
		{ channelCount: 2, bitrateKbps: 56 },
		{ channelCount: 2, bitrateKbps: 80 },
	] as const) {
		const request = encodeRequest({ sampleRate: 48_000, ...fixture, frameCount: 1_152 });
		assert.equal((await runtime.preflightRequest?.(request, {
			operation: deriveDesktopAudioCodecOperation(request),
		}))?.disposition, 'unsupported');
		const result = await execute(runtime, request);
		assert.equal(result.status, 'failed');
		if (result.status === 'failed') assert.equal(result.reason, 'unavailable');
	}
});

test('TwoLAME rejects mismatches and treats bad PCM, output, and cancellation as terminal', async () => {
	const runtime = await requiredRuntime('mac-arm64');
	const ordinary = encodeRequest({
		sampleRate: 48_000, channelCount: 2, bitrateKbps: 192, frameCount: 1_152,
	});
	const mp3: Extract<DesktopAudioCodecRequest, {
		readonly operation: 'audio-encode'; readonly format: 'mp3';
	}> = Object.freeze({ ...ordinary, format: 'mp3' as const });
	assert.equal((await runtime.preflightRequest?.(mp3, {
		operation: deriveDesktopAudioCodecOperation(mp3),
	}))?.disposition, 'rejected');
	assert.equal((await runtime.provider.preflight({
		...deriveDesktopAudioCodecOperation(ordinary), direction: 'decode', sampleFormat: 'f32',
	}, {})).disposition, 'unsupported');

	const invalid = encodeRequest({
		sampleRate: 48_000, channelCount: 1, bitrateKbps: 128, frameCount: 2,
		input: floatBytes([0, Number.POSITIVE_INFINITY]),
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
	const exactBound = await execute(runtime, encodeRequest({
		sampleRate: 48_000, channelCount: 2, bitrateKbps: 192, frameCount: 1_152,
		maximumOutputBytes: 576,
	}));
	assert.equal(exactBound.status, 'executed');
	if (exactBound.status === 'executed') assert.equal(exactBound.output.byteLength, 576);

	const controller = new AbortController();
	controller.abort(new Error('stop-twolame'));
	await assert.rejects(runtime.execute(ordinary, {
		operation: deriveDesktopAudioCodecOperation(ordinary), signal: controller.signal,
	}), /stop-twolame/u);
});

async function requiredRuntime(
	target: 'linux-x64' | 'linux-arm64' | 'mac-arm64' | 'win-arm64' | 'win-x64',
): Promise<DesktopAudioCodecProviderRuntime> {
	const runtime = await loadBundledTwolameAudioCodecRuntime({ target });
	assert.ok(runtime);
	return runtime;
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
}>): Extract<DesktopAudioCodecRequest, {
	readonly operation: 'audio-encode'; readonly format: 'mp2';
}> {
	return Object.freeze({
		operation: 'audio-encode', format: 'mp2',
		input: options.input ?? sinePcm(options.frameCount, options.channelCount, options.sampleRate),
		sampleRate: options.sampleRate, channelCount: options.channelCount,
		settings: Object.freeze({ bitrateKbps: options.bitrateKbps }),
		maximumOutputBytes: options.maximumOutputBytes ?? 1024 * 1024,
		requestId: 'twolame-encode',
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
