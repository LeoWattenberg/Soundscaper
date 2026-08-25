/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	BUNDLED_MPG123_WASM_BYTE_LENGTH,
	BUNDLED_MPG123_WASM_SHA256,
	loadBundledMpg123AudioCodecRuntime,
} from '../desktop/bundled-mpg123-audio-codec-runtime.ts';
import { loadBundledTwolameAudioCodecRuntime } from '../desktop/bundled-twolame-audio-codec-runtime.ts';
import { deriveDesktopAudioCodecOperation } from '../desktop/desktop-audio-codec-broker.ts';
import { parseBundledMpegAudioStream } from '../desktop/bundled-mpeg-audio-stream.ts';
import type {
	DesktopAudioCodecProviderExecutionResult,
	DesktopAudioCodecProviderRuntime,
} from '../desktop/desktop-audio-codec-broker.ts';
import type {
	DesktopAudioCodecFormat,
	DesktopAudioCodecRequest,
} from '../desktop/desktop-audio-codec-operation-contract.ts';
import { DESKTOP_CODEC_TARGETS } from '../src/common/editor/desktop-codec-provider-catalog.ts';
import { testMpegAudioStream, withId3v2 } from './helpers/mpeg-audio-fixture.ts';

test('the exact mpg123 artifact gates MP3 and MP2 decoding on all five targets', async () => {
	for (const target of DESKTOP_CODEC_TARGETS) {
		const runtime = await loadBundledMpg123AudioCodecRuntime({ target });
		assert.ok(runtime, target);
		assert.equal(runtime.provider.kind, 'bundled');
		assert.equal(runtime.provider.implementation, 'libmpg123-wasm-feed-f32');
		assert.match(runtime.provider.capabilityGeneration, new RegExp(BUNDLED_MPG123_WASM_SHA256, 'u'));
	}
	assert.equal(BUNDLED_MPG123_WASM_BYTE_LENGTH > 0, true);
	assert.equal(await loadBundledMpg123AudioCodecRuntime({
		target: 'win-x64', readPayload: async () => new Uint8Array(BUNDLED_MPG123_WASM_BYTE_LENGTH),
	}), null);
	await assert.rejects(loadBundledMpg123AudioCodecRuntime({
		target: 'mac-x64' as 'mac-arm64',
	}), /target/iu);
});

test('mpg123 emits exact finite interleaved float32 geometry for MP3 and MP2', async () => {
	const runtime = await requiredRuntime('linux-x64');
	for (const candidate of [
		{ format: 'mp3' as const, layer: 3 as const, sampleRate: 44_100, channelCount: 2 },
		{ format: 'mp2' as const, layer: 2 as const, sampleRate: 48_000, channelCount: 1 },
	]) {
		const input = testMpegAudioStream({
			layer: candidate.layer, frameCount: 4,
			sampleRate: candidate.sampleRate as 44_100 | 48_000,
			channelCount: candidate.channelCount as 1 | 2,
		});
		const result = await execute(runtime, decodeRequest(candidate.format, input));
		assert.equal(result.status, 'executed', candidate.format);
		if (result.status !== 'executed') continue;
		assert.deepEqual(result.decodedGeometry, {
			sampleRate: candidate.sampleRate, channelCount: candidate.channelCount,
			frameCount: 4 * 1_152,
		});
		assert.equal(result.output.byteLength, 4 * 1_152 * candidate.channelCount * 4);
		for (const sample of new Float32Array(
			result.output.buffer, result.output.byteOffset, result.output.byteLength / 4,
		)) assert.equal(Number.isFinite(sample), true);
	}
});

test('mpg123 interoperates with upstream LAME and stock TwoLAME streams', async () => {
	const runtime = await requiredRuntime('linux-x64');
	for (const candidate of [
		{
			file: 'fixtures/mpg123-sweep-raw.base64', format: 'mp3' as const,
			inputSha256: '7861fcf4810ad6152ecd4a2b4a8d26cedb8e290fcad4295b919793a2a6a4567d',
			outputSha256: 'a73aa459b250fe55fc7b1719be63733b9bef749bb27bc0307c6879dbf8c2976b',
			geometry: { sampleRate: 44_100, channelCount: 2, frameCount: 44_100 },
		},
		{
			file: 'fixtures/twolame-0.4.0-sine.mp2.base64', format: 'mp2' as const,
			inputSha256: 'e9b1c67893907f7449f8dd1a57e20c463709d4bd8068483a0c083d5f17e86f8c',
			outputSha256: '4ff65175379bb0efff3742a326adfe69471af30c335d48cf16fc086e0b1ccceb',
			geometry: { sampleRate: 48_000, channelCount: 2, frameCount: 5_760 },
		},
	]) {
		const encoded = new Uint8Array(Buffer.from((await readFile(
			new URL(candidate.file, import.meta.url), 'utf8',
		)).trim(), 'base64'));
		assert.equal(sha256(encoded), candidate.inputSha256);
		const result = await execute(runtime, decodeRequest(candidate.format, encoded));
		assert.equal(result.status, 'executed');
		if (result.status !== 'executed') continue;
		assert.deepEqual(result.decodedGeometry, candidate.geometry);
		assert.equal(sha256(result.output), candidate.outputSha256);
		assert.equal(new Float32Array(
			result.output.buffer, result.output.byteOffset, result.output.byteLength / 4,
		).some((sample) => Math.abs(sample) > 0.01), true);
	}
});

test('mpg123 decodes a valid one-frame TwoLAME MP2 stream without next-frame readahead', async () => {
	const encoder = await loadBundledTwolameAudioCodecRuntime({ target: 'linux-x64' });
	assert.ok(encoder);
	const frameCount = 1_152;
	const channelCount = 2;
	const sampleRate = 48_000;
	const input = new Float32Array(frameCount * channelCount);
	for (let frame = 0; frame < frameCount; frame++) {
		input[frame * channelCount] = Math.sin(2 * Math.PI * 440 * frame / sampleRate) * 0.35;
		input[frame * channelCount + 1] = Math.sin(2 * Math.PI * 660 * frame / sampleRate) * 0.25;
	}
	const encodeRequest: DesktopAudioCodecRequest = Object.freeze({
		operation: 'audio-encode', format: 'mp2', input: new Uint8Array(input.buffer),
		sampleRate, channelCount, settings: Object.freeze({ bitrateKbps: 192 }),
		maximumOutputBytes: 64 * 1024, requestId: 'mpg123-one-frame-source',
	});
	const encoded = await execute(encoder, encodeRequest);
	assert.equal(encoded.status, 'executed');
	if (encoded.status !== 'executed') return;
	assert.deepEqual(parseBundledMpegAudioStream(encoded.output, 'mp2'), {
		format: 'mp2', layer: 2, mpegVersion: 1, sampleRate, channelCount,
		frameCount, mpegFrameCount: 1, samplesPerFrame: 1_152, bitrateKbps: 192,
		encoderDelay: 0, endPadding: 0, gapless: 'none',
	});

	const runtime = await requiredRuntime('linux-x64');
	const request = decodeRequest('mp2', encoded.output);
	assert.deepEqual(await runtime.preflightRequest?.(request, {
		operation: deriveDesktopAudioCodecOperation(request),
	}), { disposition: 'supported', reason: null });
	const decoded = await execute(runtime, request);
	assert.equal(decoded.status, 'executed');
	if (decoded.status !== 'executed') return;
	assert.deepEqual(decoded.decodedGeometry, { sampleRate, channelCount, frameCount });
	assert.equal(decoded.output.byteLength, frameCount * channelCount * Float32Array.BYTES_PER_ELEMENT);
	assert.equal(new Float32Array(
		decoded.output.buffer, decoded.output.byteOffset,
		decoded.output.byteLength / Float32Array.BYTES_PER_ELEMENT,
	).some((sample) => Math.abs(sample) > 0.01), true);
});

test('valid unreviewed streams fall through while malformed streams and bounds fail terminally', async () => {
	const runtime = await requiredRuntime('win-arm64');
	const mp3 = testMpegAudioStream({ layer: 3, frameCount: 3 });
	const tagged = decodeRequest('mp3', withId3v2(mp3));
	assert.equal((await runtime.preflightRequest?.(tagged, {
		operation: deriveDesktopAudioCodecOperation(tagged),
	}))?.disposition, 'unsupported');
	const truncated = decodeRequest('mp3', mp3.subarray(0, mp3.byteLength - 1));
	assert.equal((await runtime.preflightRequest?.(truncated, {
		operation: deriveDesktopAudioCodecOperation(truncated),
	}))?.disposition, 'rejected');
	const rejected = await execute(runtime, truncated);
	assert.equal(rejected.status, 'failed');
	if (rejected.status === 'failed') assert.equal(rejected.reason, 'security-failed');
	const bounded = await execute(runtime, {
		...decodeRequest('mp3', mp3), maximumOutputBytes: 3 * 1_152 * 2 * 4 - 1,
	});
	assert.equal(bounded.status, 'failed');
	if (bounded.status === 'failed') assert.equal(bounded.reason, 'result-failed');
});

test('mpg123 admits no encoder and an aborted request never enters WebAssembly', async () => {
	const runtime = await requiredRuntime('mac-arm64');
	const input = testMpegAudioStream({ layer: 2 });
	const request = decodeRequest('mp2', input);
	const controller = new AbortController();
	controller.abort(new Error('stop-mpg123'));
	await assert.rejects(runtime.execute(request, {
		operation: deriveDesktopAudioCodecOperation(request), signal: controller.signal,
	}), /stop-mpg123/u);
	const encode = Object.freeze({
		operation: 'audio-encode' as const, format: 'mp3' as const,
		input: new Uint8Array(4), sampleRate: 44_100, channelCount: 1,
		settings: Object.freeze({ bitrateKbps: 128 }), maximumOutputBytes: 1_024,
	});
	assert.equal((await runtime.preflightRequest?.(encode, {
		operation: deriveDesktopAudioCodecOperation(encode),
	}))?.disposition, 'rejected');
});

async function requiredRuntime(target: 'linux-x64' | 'mac-arm64' | 'win-arm64' | 'win-x64') {
	const runtime = await loadBundledMpg123AudioCodecRuntime({ target });
	assert.ok(runtime);
	return runtime;
}

async function execute(runtime: DesktopAudioCodecProviderRuntime, request: DesktopAudioCodecRequest) {
	return await runtime.execute(request, {
		operation: deriveDesktopAudioCodecOperation(request),
	}) as DesktopAudioCodecProviderExecutionResult;
}

function decodeRequest(format: Extract<DesktopAudioCodecFormat, 'mp3' | 'mp2'>, input: Uint8Array): DesktopAudioCodecRequest {
	return Object.freeze({
		operation: 'audio-decode', format, input, sampleRate: null, channelCount: null,
		settings: Object.freeze({ sampleFormat: 'f32le' }), maximumOutputBytes: 1024 * 1024,
		requestId: `mpg123-${format}-decode`,
	});
}

function sha256(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}
