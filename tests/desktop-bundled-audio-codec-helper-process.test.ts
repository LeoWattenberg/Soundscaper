/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	createBundledAudioCodecHelperWorker,
	runBundledAudioCodecHelperJob,
	type BundledAudioCodecHelperConfiguration,
} from '../desktop/bundled-audio-codec-helper-process.ts';
import type { DesktopAudioCodecProviderRuntime } from '../desktop/desktop-audio-codec-broker.ts';

const digest = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');

async function fixture(context: TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-bundled-helper-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const runtimeRoot = join(root, 'runtime');
	const scratchRoot = join(root, 'scratch');
	const modulePath = join(runtimeRoot, 'desktop/bundled-flac-audio-codec-runtime.js');
	const wasmPath = join(runtimeRoot, 'src/common/editor/flac/flac.wasm');
	const helperPath = join(runtimeRoot, 'desktop/bundled-audio-codec-helper-process.js');
	await mkdir(join(runtimeRoot, 'desktop'), { recursive: true });
	await mkdir(join(runtimeRoot, 'src/common/editor/flac'), { recursive: true });
	await mkdir(scratchRoot, { recursive: true });
	const moduleBytes = Buffer.from('export const reviewed = true;\n');
	const wasmBytes = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
	const helperBytes = Buffer.from('reviewed helper');
	await writeFile(modulePath, moduleBytes);
	await writeFile(wasmPath, wasmBytes);
	await writeFile(helperPath, helperBytes);
	const configuration: BundledAudioCodecHelperConfiguration = Object.freeze({
		contractVersion: 1, target: 'linux-x64', codec: 'flac', runtimeRoot,
		moduleBytes: moduleBytes.byteLength, moduleSha256: digest(moduleBytes),
		wasmBytes: wasmBytes.byteLength, wasmSha256: digest(wasmBytes),
	});
	return { root, runtimeRoot, scratchRoot, modulePath, wasmPath, configuration };
}

function runtime(options: Readonly<{
	preflight?: DesktopAudioCodecProviderRuntime['preflightRequest'];
	execute?: DesktopAudioCodecProviderRuntime['execute'];
}> = {}): DesktopAudioCodecProviderRuntime {
	return Object.freeze({
		provider: Object.freeze({
			kind: 'bundled' as const, id: 'bundled-libflac-wasm-linux-x64',
			implementation: 'libflac-wasm-f32-to-s24', version: '1.5.0',
			capabilityGeneration: `libflac-${'a'.repeat(64)}`,
			async preflight() { return Object.freeze({ disposition: 'supported' as const, reason: null }); },
		}),
		preflightRequest: options.preflight ?? (async () => Object.freeze({
			disposition: 'supported' as const, reason: null,
		})),
		execute: options.execute ?? (async () => Object.freeze({
			status: 'executed' as const,
			output: new Uint8Array(new Float32Array([0.25, -0.25]).buffer),
			decodedGeometry: Object.freeze({ sampleRate: 48_000, channelCount: 2, frameCount: 1 }),
		})),
	});
}

function operation() {
	return Object.freeze({
		direction: 'decode' as const, mediaKind: 'audio' as const,
		container: 'flac', codec: 'flac', profile: null,
		sampleFormat: 'f32', pixelFormat: null,
		sampleRate: null, channelCount: null, width: null, height: null,
	});
}

async function jobFiles(scratchRoot: string) {
	const input = Uint8Array.of(102, 76, 97, 67);
	const inputPath = join(scratchRoot, 'input.flac');
	const outputPath = join(scratchRoot, 'output.f32le');
	await writeFile(inputPath, input, { flag: 'wx', mode: 0o600 });
	return {
		input, inputPath, outputPath,
		request: Object.freeze({
			contractVersion: 1 as const, operation: 'audio-decode' as const, format: 'flac' as const,
			inputPath, outputPath, inputBytes: input.byteLength, inputSha256: digest(input),
			maximumOutputBytes: 1_024, sampleRate: null, channelCount: null,
			settings: Object.freeze({ sampleFormat: 'f32le' as const }),
		}),
	};
}

test('helper authenticates its fixed codec module and wasm before announcing ready', async (context) => {
	const files = await fixture(context);
	const posted: unknown[] = [];
	let payload: Uint8Array | null = null;
	const worker = await createBundledAudioCodecHelperWorker({
		configuration: files.configuration,
		post: (message) => { posted.push(message); },
		exit: () => assert.fail('startup must not exit'),
		ports: {
			importRuntime: async (path, options) => {
				assert.equal(path, files.modulePath);
				payload = await options.readPayload();
				return runtime();
			},
		},
	});
	assert.deepEqual(posted, [{
		contractVersion: 1, type: 'ready', target: 'linux-x64', codec: 'flac',
	}]);
	assert.deepEqual([...payload!], [...await readFile(files.wasmPath)]);
	assert.equal(typeof worker.handleMessage, 'function');

	await writeFile(files.modulePath, 'changed module');
	await assert.rejects(() => createBundledAudioCodecHelperWorker({
		configuration: files.configuration, post() {}, exit() {},
		ports: { importRuntime: async () => runtime() },
	}), /module.*identity|module.*digest/iu);
});

test('helper runs bounded preflight and execution jobs through private files', async (context) => {
	const files = await fixture(context);
	const staged = await jobFiles(files.scratchRoot);
	const observed: unknown[] = [];
	const codecRuntime = runtime({
		preflight: async (request, options) => {
			observed.push({ request, options });
			return Object.freeze({ disposition: 'unsupported' as const, reason: 'exact profile mismatch' });
		},
	});
	const preflight = await runBundledAudioCodecHelperJob({
		configuration: files.configuration, runtime: codecRuntime,
		value: Object.freeze({
			contractVersion: 1, type: 'job', phase: 'preflight',
			operation: operation(), request: staged.request,
		}),
	});
	assert.deepEqual(preflight, {
		contractVersion: 1, status: 'preflight', disposition: 'unsupported',
		reason: 'exact profile mismatch',
	});
	assert.equal((observed[0] as { request: { input: Uint8Array } }).request.input instanceof Uint8Array, true);
	assert.deepEqual((observed[0] as { request: { input: Uint8Array } }).request.input, staged.input);

	const execute = await runBundledAudioCodecHelperJob({
		configuration: files.configuration, runtime: runtime(),
		value: Object.freeze({
			contractVersion: 1, type: 'job', phase: 'execute',
			operation: operation(), request: staged.request,
		}),
	});
	const output = await readFile(staged.outputPath);
	assert.deepEqual(execute, {
		contractVersion: 1, status: 'executed', outputBytes: output.byteLength,
		outputSha256: digest(output),
		decodedGeometry: { sampleRate: 48_000, channelCount: 2, frameCount: 1 },
	});
});

test('helper rejects path escapes, changed input, oversized output, and inexact messages', async (context) => {
	const files = await fixture(context);
	const staged = await jobFiles(files.scratchRoot);
	const base = Object.freeze({
		contractVersion: 1, type: 'job', phase: 'execute', operation: operation(), request: staged.request,
	});
	await writeFile(staged.inputPath, Uint8Array.of(0), { flag: 'w' });
	await assert.rejects(() => runBundledAudioCodecHelperJob({
		configuration: files.configuration, runtime: runtime(), value: base,
	}), /input.*identity|input.*length|input.*digest/iu);

	const secondRoot = join(files.root, 'second');
	await mkdir(secondRoot, { recursive: true });
	const second = await jobFiles(secondRoot);
	await assert.rejects(() => runBundledAudioCodecHelperJob({
		configuration: files.configuration, runtime: runtime({
			execute: async () => Object.freeze({
				status: 'executed', output: new Uint8Array(2_048),
				decodedGeometry: Object.freeze({ sampleRate: 48_000, channelCount: 1, frameCount: 512 }),
			}),
		}),
		value: { ...base, request: second.request, extra: true },
	}), /inexact shape|invalid/iu);
	await assert.rejects(() => runBundledAudioCodecHelperJob({
		configuration: files.configuration, runtime: runtime({
			execute: async () => Object.freeze({
				status: 'executed', output: new Uint8Array(2_048),
				decodedGeometry: Object.freeze({ sampleRate: 48_000, channelCount: 1, frameCount: 512 }),
			}),
		}),
		value: { ...base, request: second.request },
	}), /output.*bound/iu);
});

test('worker accepts exactly one job and fails closed on a duplicate message', async (context) => {
	const files = await fixture(context);
	const staged = await jobFiles(files.scratchRoot);
	const posted: unknown[] = [];
	const exits: number[] = [];
	let release: (() => void) | undefined;
	const pending = new Promise<void>((resolve) => { release = resolve; });
	const worker = await createBundledAudioCodecHelperWorker({
		configuration: files.configuration,
		post: (message) => { posted.push(message); },
		exit: (code) => { exits.push(code); },
		schedule: (callback) => { callback(); },
		ports: {
			importRuntime: async () => runtime({
				execute: async () => {
					await pending;
					return Object.freeze({ status: 'failed', reason: 'execution-failed', detail: 'stopped' });
				},
			}),
		},
	});
	const job = Object.freeze({
		contractVersion: 1, type: 'job', phase: 'execute', operation: operation(), request: staged.request,
	});
	worker.handleMessage(job);
	worker.handleMessage(job);
	assert.deepEqual(exits, [1]);
	release?.();
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(posted, [{
		contractVersion: 1, type: 'ready', target: 'linux-x64', codec: 'flac',
	}]);
});
