/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	createOperatingSystemAudioCodecHelperWorker,
	runOperatingSystemAudioCodecJob,
	runOperatingSystemAudioDecodeJob,
} from '../desktop/os-audio-codec-helper-process.js';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const job = (value) => ({ configuration: value.configuration, request: value.request });

async function fixture(context, format = 'mp3', operation = 'audio-decode') {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-os-codec-helper-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const addonPath = join(root, 'soundscaper_professional.node');
	const inputPath = join(root, operation === 'audio-encode'
		? 'input.f32le' : format === 'mp3' ? 'input.mp3' : 'input.m4a');
	const outputPath = join(root, operation === 'audio-encode' ? 'output.m4a' : 'output.f32le');
	const addonBytes = Buffer.from('authenticated-addon');
	const input = operation === 'audio-encode'
		? new Uint8Array(new Float32Array([0.25, -0.25, 0.5, -0.5]).buffer)
		: Uint8Array.of(1, 2, 3, 4);
	await writeFile(addonPath, addonBytes);
	await writeFile(inputPath, input);
	return {
		root, addonPath, inputPath, outputPath, input,
		configuration: {
			contractVersion: 1, target: 'mac-arm64', addonPath, addonSha256: sha256(addonBytes),
		},
		request: {
			contractVersion: 1, operation, format, inputPath, outputPath, inputBytes: input.byteLength,
			inputSha256: sha256(input), maximumOutputBytes: 1024,
			...(operation === 'audio-encode'
				? { sampleRate: 48_000, channelCount: 2, bitrateKbps: 160 }
				: {}),
		},
	};
}

test('helper reauthenticates its addon and input then returns exact decoded geometry', async (context) => {
	const value = await fixture(context);
	const output = new Uint8Array(new Float32Array([0.25, -0.25, 0.5, -0.5]).buffer);
	let addonCalls = 0;
	const result = await runOperatingSystemAudioDecodeJob(job(value), {
		loadAddon: async ({ addonPath, addonSha256 }) => {
			assert.equal(addonPath, value.addonPath);
			assert.equal(addonSha256, value.configuration.addonSha256);
			return Object.freeze({
				decodeOperatingSystemMp3: async (request) => {
					addonCalls += 1;
					assert.deepEqual(request, {
						inputPath: value.inputPath, outputPath: value.outputPath,
						inputBytes: 4, maximumOutputBytes: 1024,
					});
					await writeFile(value.outputPath, output, { flag: 'wx' });
					return {
						status: 'decoded', nativeApiReached: true, exactTuplePassed: true,
						outputBytes: output.byteLength, frameCount: 2,
						sampleRate: 48_000, channelCount: 2,
					};
				},
			});
		},
	});
	assert.equal(addonCalls, 1);
	assert.deepEqual(result, {
		contractVersion: 1, status: 'decoded', nativeApiReached: true,
		exactTuplePassed: true, outputBytes: output.byteLength,
		outputSha256: sha256(output),
		decodedGeometry: { sampleRate: 48_000, channelCount: 2, frameCount: 2 },
	});
	assert.deepEqual(new Uint8Array(await readFile(value.outputPath)), output);
});

test('helper dispatches exact AAC-LC M4A encode and binds its source tuple', async (context) => {
	const value = await fixture(context, 'aac-m4a', 'audio-encode');
	const output = Buffer.from('bounded-m4a-output');
	let calls = 0;
	const result = await runOperatingSystemAudioCodecJob(job(value), {
		loadAddon: async () => Object.freeze({
			decodeOperatingSystemAacM4a: () => assert.fail('encode must not dispatch to decode'),
			encodeOperatingSystemAacM4a: async (request) => {
				calls += 1;
				assert.deepEqual(request, {
					inputPath: value.inputPath, outputPath: value.outputPath,
					inputBytes: 16, maximumOutputBytes: 1024,
					sampleRate: 48_000, channelCount: 2, bitrateKbps: 160,
				});
				await writeFile(value.outputPath, output, { flag: 'wx' });
				return {
					status: 'encoded', nativeApiReached: true, exactTuplePassed: true,
					outputBytes: output.byteLength, frameCount: 2,
					sampleRate: 48_000, channelCount: 2, bitrateKbps: 160,
				};
			},
		}),
	});
	assert.equal(calls, 1);
	assert.deepEqual(result, {
		contractVersion: 1, status: 'encoded', nativeApiReached: true,
		exactTuplePassed: true, outputBytes: output.byteLength,
		outputSha256: sha256(output),
		encodedTuple: {
			sampleRate: 48_000, channelCount: 2, frameCount: 2, bitrateKbps: 160,
		},
	});
});

test('helper dispatches AAC-LC M4A only to the reviewed native AAC method', async (context) => {
	const value = await fixture(context, 'aac-m4a');
	const output = new Uint8Array(new Float32Array([0.25, -0.25]).buffer);
	let calls = 0;
	const result = await runOperatingSystemAudioDecodeJob(job(value), {
		loadAddon: async () => Object.freeze({
			decodeOperatingSystemMp3: () => assert.fail('AAC must not dispatch to MP3'),
			decodeOperatingSystemAacM4a: async (request) => {
				calls += 1;
				assert.equal(request.inputPath, value.inputPath);
				await writeFile(value.outputPath, output, { flag: 'wx' });
				return {
					status: 'decoded', nativeApiReached: true, exactTuplePassed: true,
					outputBytes: output.byteLength, frameCount: 1,
					sampleRate: 48_000, channelCount: 2,
				};
			},
		}),
	});
	assert.equal(calls, 1);
	assert.deepEqual(result, {
		contractVersion: 1, status: 'decoded', nativeApiReached: true,
		exactTuplePassed: true, outputBytes: output.byteLength,
		outputSha256: sha256(output),
		decodedGeometry: { sampleRate: 48_000, channelCount: 2, frameCount: 1 },
	});
});

test('helper passes through only closed native unavailability', async (context) => {
	const value = await fixture(context);
	const result = await runOperatingSystemAudioDecodeJob(job(value), {
		loadAddon: async () => ({
			decodeOperatingSystemMp3: () => ({
				status: 'tuple-unsupported', nativeApiReached: true, exactTuplePassed: false,
				outputBytes: 0, frameCount: 0, sampleRate: 0, channelCount: 0,
			}),
		}),
	});
	assert.deepEqual(result, {
		contractVersion: 1, status: 'unavailable', reason: 'tuple-unsupported',
		nativeApiReached: true,
	});
});

test('helper refuses changed input, changed addon, malformed native answers, and oversized output', async (context) => {
	const changedInput = await fixture(context);
	await writeFile(changedInput.inputPath, Uint8Array.of(9, 9, 9, 9));
	await assert.rejects(() => runOperatingSystemAudioDecodeJob(job(changedInput), {
		loadAddon: async () => { throw new Error('must not load'); },
	}), /input.*digest/iu);

	const changedAddon = await fixture(context);
	changedAddon.configuration.addonSha256 = '0'.repeat(64);
	await assert.rejects(() => runOperatingSystemAudioDecodeJob(job(changedAddon), {
		loadAddon: async () => { throw new Error('must not load'); },
	}), /addon.*digest/iu);

	const malformed = await fixture(context);
	await assert.rejects(() => runOperatingSystemAudioDecodeJob(job(malformed), {
		loadAddon: async () => ({ decodeOperatingSystemMp3: () => ({ status: 'decoded' }) }),
	}), /native.*result/iu);

	const oversized = await fixture(context);
	await assert.rejects(() => runOperatingSystemAudioDecodeJob(job(oversized), {
		loadAddon: async () => ({
			decodeOperatingSystemMp3: async () => {
				await writeFile(oversized.outputPath, new Uint8Array(1025), { flag: 'wx' });
				return {
					status: 'decoded', nativeApiReached: true, exactTuplePassed: true,
					outputBytes: 1025, frameCount: 1, sampleRate: 48_000, channelCount: 2,
				};
			},
		}),
	}), /output.*bound|native.*result/iu);
});

test('helper rejects macOS x64 and inexact control records before native code', async (context) => {
	const value = await fixture(context);
	await assert.rejects(() => runOperatingSystemAudioDecodeJob({
		configuration: { ...value.configuration, target: 'mac-x64' }, request: value.request,
	}, { loadAddon: async () => ({}) }), /target/iu);
	await assert.rejects(() => runOperatingSystemAudioDecodeJob({
		configuration: value.configuration, request: { ...value.request, extra: true },
	}, { loadAddon: async () => ({}) }), /request/iu);
});

test('one-shot worker closes its wire and binds configuration to the process target', async () => {
	const configuration = {
		contractVersion: 1, target: 'mac-arm64', addonPath: '/private/addon.node',
		addonSha256: 'a'.repeat(64),
	};
	const messages = [];
	const exits = [];
	let resolveJob;
	const completion = new Promise((resolve) => { resolveJob = resolve; });
	const worker = createOperatingSystemAudioCodecHelperWorker({
		configuration, platform: 'darwin', arch: 'arm64',
		post: (message) => messages.push(message),
		exit: (code) => exits.push(code),
		runJob: async (jobValue) => {
			assert.deepEqual(jobValue, { configuration, request: { exact: true } });
			await completion;
			return { decoded: true };
		},
	});
	assert.deepEqual(messages, [{ contractVersion: 1, type: 'ready', target: 'mac-arm64' }]);
	worker.handleMessage({ contractVersion: 1, type: 'job', request: { exact: true } });
	worker.handleMessage({ contractVersion: 1, type: 'job', request: { second: true } });
	assert.deepEqual(exits, [1]);
	resolveJob();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(messages.length, 1);

	assert.throws(() => createOperatingSystemAudioCodecHelperWorker({
		configuration, platform: 'darwin', arch: 'x64', post: () => undefined,
	}), /process target/iu);
	const inexactExits = [];
	const closedWorker = createOperatingSystemAudioCodecHelperWorker({
		configuration, platform: 'darwin', arch: 'arm64', post: () => undefined,
		exit: (code) => inexactExits.push(code), runJob: () => Promise.resolve({}),
	});
	closedWorker.handleMessage({ contractVersion: 1, type: 'job', request: {}, extra: true });
	assert.deepEqual(inexactExits, [1]);

	const successMessages = [];
	const successExits = [];
	const successWorker = createOperatingSystemAudioCodecHelperWorker({
		configuration, platform: 'darwin', arch: 'arm64',
		post: (message) => successMessages.push(message),
		exit: (code) => successExits.push(code),
		runJob: () => Promise.resolve({ decoded: true }),
	});
	successWorker.handleMessage({ contractVersion: 1, type: 'job', request: { exact: true } });
	await new Promise((resolve) => setImmediate(resolve));
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(successMessages, [
		{ contractVersion: 1, type: 'ready', target: 'mac-arm64' },
		{ contractVersion: 1, type: 'result', result: { decoded: true } },
	]);
	assert.deepEqual(successExits, [0]);
});
