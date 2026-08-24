/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runOperatingSystemMp3DecodeJob } from '../desktop/os-audio-codec-helper-process.js';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const job = (value) => ({ configuration: value.configuration, request: value.request });

async function fixture(context) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-os-codec-helper-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const addonPath = join(root, 'soundscaper_professional.node');
	const inputPath = join(root, 'input.mp3');
	const outputPath = join(root, 'output.f32le');
	const addonBytes = Buffer.from('authenticated-addon');
	const input = Uint8Array.of(1, 2, 3, 4);
	await writeFile(addonPath, addonBytes);
	await writeFile(inputPath, input);
	return {
		root, addonPath, inputPath, outputPath, input,
		configuration: {
			contractVersion: 1, target: 'mac-arm64', addonPath, addonSha256: sha256(addonBytes),
		},
		request: {
			contractVersion: 1, inputPath, outputPath, inputBytes: input.byteLength,
			inputSha256: sha256(input), maximumOutputBytes: 1024,
		},
	};
}

test('helper reauthenticates its addon and input then returns exact decoded geometry', async (context) => {
	const value = await fixture(context);
	const output = new Uint8Array(new Float32Array([0.25, -0.25, 0.5, -0.5]).buffer);
	let addonCalls = 0;
	const result = await runOperatingSystemMp3DecodeJob(job(value), {
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

test('helper passes through only closed native unavailability', async (context) => {
	const value = await fixture(context);
	const result = await runOperatingSystemMp3DecodeJob(job(value), {
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
	await assert.rejects(() => runOperatingSystemMp3DecodeJob(job(changedInput), {
		loadAddon: async () => { throw new Error('must not load'); },
	}), /input.*digest/iu);

	const changedAddon = await fixture(context);
	changedAddon.configuration.addonSha256 = '0'.repeat(64);
	await assert.rejects(() => runOperatingSystemMp3DecodeJob(job(changedAddon), {
		loadAddon: async () => { throw new Error('must not load'); },
	}), /addon.*digest/iu);

	const malformed = await fixture(context);
	await assert.rejects(() => runOperatingSystemMp3DecodeJob(job(malformed), {
		loadAddon: async () => ({ decodeOperatingSystemMp3: () => ({ status: 'decoded' }) }),
	}), /native.*result/iu);

	const oversized = await fixture(context);
	await assert.rejects(() => runOperatingSystemMp3DecodeJob(job(oversized), {
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
	await assert.rejects(() => runOperatingSystemMp3DecodeJob({
		configuration: { ...value.configuration, target: 'mac-x64' }, request: value.request,
	}, { loadAddon: async () => ({}) }), /target/iu);
	await assert.rejects(() => runOperatingSystemMp3DecodeJob({
		configuration: value.configuration, request: { ...value.request, extra: true },
	}, { loadAddon: async () => ({}) }), /request/iu);
});
