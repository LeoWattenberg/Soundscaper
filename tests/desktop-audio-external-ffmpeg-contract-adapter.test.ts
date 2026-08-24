/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import type { ExternalFfmpegRuntimeAdmission } from '../desktop/external-ffmpeg-preference-service.ts';
import {
	createDesktopAudioExternalFfmpegOperationContract,
	externalFfmpegAdmissionSupportsDesktopAudioRequest,
} from '../desktop/desktop-audio-external-ffmpeg-contract-adapter.ts';
import {
	DESKTOP_AUDIO_FFMPEG_INPUT_NAME,
	buildDesktopAudioFfmpegPlan,
} from '../desktop/desktop-audio-ffmpeg-plan.ts';

const PRIVATE_DIRECTORY = resolve('test-private-ffmpeg-operation');
const FILES = Object.freeze({
	inputPath: join(PRIVATE_DIRECTORY, 'input.media'),
	outputPath: join(PRIVATE_DIRECTORY, 'output.media'),
	maximumOutputBytes: 8_192,
});

test('the adapter admits only a normalized closed desktop audio request', () => {
	const contract = createDesktopAudioExternalFfmpegOperationContract();
	const source = new Uint8Array(8);
	const admitted = contract.admitOperation(encodeRequest({ input: source }));
	assert.equal(admitted.status, 'admitted');
	if (admitted.status !== 'admitted') return;
	assert.equal(Object.isFrozen(admitted.operation), true);
	assert.equal(Object.isFrozen(admitted.operation.settings), true);
	assert.notEqual(admitted.operation.input, source);
	source[0] = 255;
	assert.equal(admitted.operation.input[0], 0);
	assert.equal(contract.maximumOutputBytes?.(admitted.operation), 8_192);

	for (const injected of [
		{ ...encodeRequest(), argv: ['-i', '/renderer/input'] },
		{ ...encodeRequest(), inputPath: '/renderer/input' },
		{ ...encodeRequest(), outputUrl: 'https://attacker.invalid/output' },
		{ ...encodeRequest(), ffmpegPath: '/renderer/ffmpeg' },
	]) assert.deepEqual(contract.admitOperation(injected), { status: 'rejected' });
});

test('argv construction substitutes only the two runner-owned absolute paths', () => {
	const contract = createDesktopAudioExternalFfmpegOperationContract();
	const request = admittedOperation(contract, encodeRequest());
	const built = contract.buildArguments(request, FILES);
	assertStringArguments(built);
	const canonical = buildDesktopAudioFfmpegPlan(request);
	const expected = canonical.arguments.map((argument) => (
		argument === canonical.inputName ? FILES.inputPath
			: argument === canonical.outputName ? FILES.outputPath : argument
	));
	assert.deepEqual(built, expected);
	assert.equal(built.filter((argument) => argument === FILES.inputPath).length, 1);
	assert.equal(built.filter((argument) => argument === FILES.outputPath).length, 1);
	assert.equal(built.includes(DESKTOP_AUDIO_FFMPEG_INPUT_NAME), false);
	assert.equal(built.at(-1), FILES.outputPath);
	assert.equal(dirname(FILES.inputPath), dirname(FILES.outputPath));
});

test('the adapter rejects non-runner file grants and mismatched per-request limits', () => {
	const contract = createDesktopAudioExternalFfmpegOperationContract();
	const request = admittedOperation(contract, encodeRequest());
	for (const files of [
		{ ...FILES, inputPath: 'relative-input.media' },
		{ ...FILES, outputPath: 'https://attacker.invalid/output' },
		{ ...FILES, outputPath: FILES.inputPath },
		{ ...FILES, outputPath: join(resolve('other-directory'), 'output.media') },
		{ ...FILES, maximumOutputBytes: 8_193 },
		{ ...FILES, argv: ['-version'] },
	]) {
		assert.throws(() => contract.buildArguments(request, files), /file grant/u);
		assert.equal(contract.validateArguments([], request, files), false);
	}
	assert.throws(
		() => contract.maximumOutputBytes?.({ ...request, maximumOutputBytes: 0 }),
		/maximum output/u,
	);
});

test('validation freshly rebuilds and compares the complete fixed plan', () => {
	const contract = createDesktopAudioExternalFfmpegOperationContract();
	const request = admittedOperation(contract, encodeRequest());
	const built = contract.buildArguments(request, FILES);
	assertStringArguments(built);
	assert.equal(contract.validateArguments(built, request, FILES), true);

	const encoderIndex = built.indexOf('libopus');
	assert.notEqual(encoderIndex, -1);
	assert.equal(contract.validateArguments(
		built.map((argument, index) => index === encoderIndex ? 'custom_encoder' : argument), request, FILES,
	), false);
	assert.equal(contract.validateArguments(
		[...built.slice(0, -1), '-filter_script', '/renderer/filter', FILES.outputPath], request, FILES,
	), false);
	assert.equal(contract.validateArguments(
		built.map((argument) => argument === FILES.inputPath ? '/renderer/input' : argument), request, FILES,
	), false);
	assert.equal(contract.validateArguments(
		[...built, FILES.outputPath], request, FILES,
	), false);
});

test('fresh validation catches operation/argv drift after argument construction', () => {
	const contract = createDesktopAudioExternalFfmpegOperationContract();
	const opus = admittedOperation(contract, encodeRequest());
	const built = contract.buildArguments(opus, FILES);
	assertStringArguments(built);
	const flac = admittedOperation(contract, {
		...encodeRequest(), format: 'flac', settings: { compressionLevel: 5 },
	});
	assert.equal(contract.validateArguments(built, flac, FILES), false);
	const flacArguments = contract.buildArguments(flac, FILES);
	assertStringArguments(flacArguments);
	assert.equal(contract.validateArguments(flacArguments, flac, FILES), true);
});

test('capability admission checks the exact request tuple and decoder alternatives', () => {
	const request = decodeRequest('mp3');
	const admission = runtimeAdmission({
		demuxers: ['mp3'], decoders: ['mp3float'], encoders: ['pcm_f32le'],
		muxers: ['f32le'], filters: ['aresample'],
	});
	assert.equal(externalFfmpegAdmissionSupportsDesktopAudioRequest(request, admission), true);
	assert.equal(externalFfmpegAdmissionSupportsDesktopAudioRequest(request, runtimeAdmission({
		...admission.capabilities, filters: [],
	})), false);
	assert.equal(externalFfmpegAdmissionSupportsDesktopAudioRequest(
		{ ...request, argv: ['-version'] }, admission,
	), false);
	assert.equal(externalFfmpegAdmissionSupportsDesktopAudioRequest(request, null), false);
});

test('encode capability admission requires the canonical encoder and muxer', () => {
	const request = encodeRequest();
	const capabilities = {
		demuxers: ['f32le'], decoders: ['pcm_f32le'], encoders: ['libopus'],
		muxers: ['opus'], filters: ['aresample'],
	};
	assert.equal(externalFfmpegAdmissionSupportsDesktopAudioRequest(
		request, runtimeAdmission(capabilities),
	), true);
	assert.equal(externalFfmpegAdmissionSupportsDesktopAudioRequest(
		request, runtimeAdmission({ ...capabilities, encoders: ['opus'] }),
	), false);
});

function admittedOperation(
	contract: ReturnType<typeof createDesktopAudioExternalFfmpegOperationContract>,
	request: unknown,
) {
	const admitted = contract.admitOperation(request);
	assert.equal(admitted.status, 'admitted');
	if (admitted.status !== 'admitted') throw new Error('The fixture request was rejected.');
	return admitted.operation;
}

function encodeRequest(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
	return {
		operation: 'audio-encode', format: 'opus', input: new Uint8Array(8),
		sampleRate: 48_000, channelCount: 2, settings: { bitrateKbps: 128 },
		maximumOutputBytes: 8_192, requestId: 'adapter-encode', ...overrides,
	};
}

function decodeRequest(format: string): Record<string, unknown> {
	return {
		operation: 'audio-decode', format, input: Uint8Array.of(1, 2, 3),
		sampleRate: 48_000, channelCount: 2, settings: { sampleFormat: 'f32le' },
		maximumOutputBytes: 8_192,
	};
}

function runtimeAdmission(
	capabilities: ExternalFfmpegRuntimeAdmission['capabilities'],
): ExternalFfmpegRuntimeAdmission {
	return Object.freeze({
		executablePath: resolve('ffmpeg'), version: '9.0.0', capabilityGeneration: 'test-generation',
		identity: Object.freeze({
			version: '9.0.0', ffmpegSha256: 'a'.repeat(64), ffprobeSha256: 'b'.repeat(64),
			dependencyClosureSha256: 'c'.repeat(64),
		}),
		capabilities,
	});
}

function assertStringArguments(value: unknown): asserts value is readonly string[] {
	assert.ok(Array.isArray(value) && value.every((entry) => typeof entry === 'string'));
}
