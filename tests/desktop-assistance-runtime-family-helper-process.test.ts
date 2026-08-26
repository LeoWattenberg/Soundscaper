/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAssistanceRuntimeFamilyHelperProcessV1,
} from '../desktop/assistance-runtime-family-helper-process.ts';
import type { AssistanceRuntimeFamilyThreadPort } from '../desktop/assistance-runtime-family-thread-worker.ts';
import { validateAssistanceRuntimeFamilyDescriptorV1 } from '../desktop/assistance-runtime-family-process-protocol.ts';

const JOB_ID = '1'.repeat(40);
const SHA = '2'.repeat(64);

function descriptor() {
	return {
		familyId: 'onnxruntime-node', runtimeVersion: '1.29.0', target: 'linux-x64',
		executionProvider: 'cpu', entrypoint: '/runtime/runtime.js',
		files: [{ path: '/runtime/runtime.js', relativePath: 'runtime.js',
			byteLength: 1, sha256: SHA, executable: false }],
	};
}

function request() {
	return {
		protocolVersion: 1, jobId: JOB_ID, familyId: 'onnxruntime-node', task: 'shot-detection',
		maximumRssBytes: 1024 ** 3, maximumDurationMs: 60_000,
		grant: {
			grantVersion: 1, jobId: JOB_ID, familyId: 'onnxruntime-node', task: 'shot-detection',
			settingsJson: '{}',
			inputs: [{ claimId: '3'.repeat(40), role: 'video', mediaType: 'video/mp4',
				path: '/private/input', byteLength: 1, sha256: SHA, identity: { dev: 1, ino: 1 } }],
			models: [{ modelId: 'transnetv2', version: '1.0.0', artifactRole: 'network',
				path: '/private/model', byteLength: 1, sha256: SHA, identity: { dev: 1, ino: 2 } }],
			outputs: [{ claimId: '4'.repeat(40), role: 'shot-boundaries',
				mediaType: 'application/vnd.soundscaper.shot-boundaries+json', path: '/private/output',
				maximumByteLength: 1_024, initialByteLength: 0,
				initialSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
				identity: { dev: 1, ino: 3 } }],
		},
	};
}

function whisperDescriptor() {
	return {
		familyId: 'whisper-cpp', runtimeVersion: 'v1.9.3', target: 'linux-x64',
		executionProvider: 'cpu', entrypoint: '/runtime/whisper-cli',
		files: [{ path: '/runtime/whisper-cli', relativePath: 'whisper-cli',
			byteLength: 1, sha256: SHA, executable: true }],
	};
}

function whisperRequest() {
	return {
		protocolVersion: 1, jobId: JOB_ID, familyId: 'whisper-cpp', task: 'speech-recognition',
		maximumRssBytes: 8 * 1024 ** 3, maximumDurationMs: 60_000,
		grant: {
			grantVersion: 1, jobId: JOB_ID, familyId: 'whisper-cpp', task: 'speech-recognition',
			settingsJson: '{}',
			inputs: [{ claimId: '3'.repeat(40), role: 'audio', mediaType: 'audio/wav',
				path: '/private/input.wav', byteLength: 1, sha256: SHA, identity: { dev: 1, ino: 1 } }],
			models: [{ modelId: 'whisper-test', version: '1.0.0', artifactRole: 'ggml',
				path: '/private/model.bin', byteLength: 1, sha256: SHA, identity: { dev: 1, ino: 2 } }],
			outputs: [{ claimId: '4'.repeat(40), role: 'transcript',
				mediaType: 'application/vnd.soundscaper.transcript+json', path: '/private/output.json',
				maximumByteLength: 1_024, initialByteLength: 0,
				initialSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
				identity: { dev: 1, ino: 3 } }],
		},
	};
}

function llamaDescriptor() {
	return {
		familyId: 'llama-cpp', runtimeVersion: 'b10509', target: 'linux-x64',
		executionProvider: 'cpu', entrypoint: '/runtime/llama-cli',
		files: [{ path: '/runtime/llama-cli', relativePath: 'llama-cli',
			byteLength: 1, sha256: SHA, executable: true }],
	};
}

function llamaRequest() {
	return {
		protocolVersion: 1, jobId: JOB_ID, familyId: 'llama-cpp', task: 'editorial-generation',
		maximumRssBytes: 12 * 1024 ** 3, maximumDurationMs: 60_000,
		grant: {
			grantVersion: 1, jobId: JOB_ID, familyId: 'llama-cpp', task: 'editorial-generation',
			settingsJson: '{}',
			inputs: [{ claimId: '3'.repeat(40), role: 'editorial-context',
				mediaType: 'application/vnd.soundscaper.editorial-context+json',
				path: '/private/context.json', byteLength: 1, sha256: SHA,
				identity: { dev: 1, ino: 1 } }],
			models: [{ modelId: 'qwen3-4b-q4-k-m', version: '1.0.0', artifactRole: 'gguf',
				path: '/private/model.gguf', byteLength: 1, sha256: SHA,
				identity: { dev: 1, ino: 2 } }],
			outputs: [{ claimId: '4'.repeat(40), role: 'editorial-proposal',
				mediaType: 'application/vnd.soundscaper.editorial-proposal+json',
				path: '/private/output.json', maximumByteLength: 1_024, initialByteLength: 0,
				initialSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
				identity: { dev: 1, ino: 3 } }],
		},
	};
}

class FakeThread implements AssistanceRuntimeFamilyThreadPort {
	readonly #listeners = new Map<string, Set<(...values: unknown[]) => void>>();
	on(event: string, listener: (...values: unknown[]) => void): this {
		const listeners = this.#listeners.get(event) ?? new Set();
		listeners.add(listener); this.#listeners.set(event, listeners); return this;
	}
	once(event: string, listener: (...values: unknown[]) => void): this {
		const once = (...values: unknown[]): void => {
			this.#listeners.get(event)?.delete(once); listener(...values);
		};
		return this.on(event, once);
	}
	terminate(): Promise<number> { return Promise.resolve(1); }
	emit(event: string, ...values: unknown[]): void {
		for (const listener of [...this.#listeners.get(event) ?? []]) listener(...values);
	}
}

test('the helper entry composes the authenticated utility shell with one worker-thread entry', async () => {
	const messages: unknown[] = [];
	const exits: number[] = [];
	const threads: FakeThread[] = [];
	const starts: unknown[][] = [];
	const helper = createAssistanceRuntimeFamilyHelperProcessV1({
		post: (message) => messages.push(message), exit: (code) => exits.push(code),
		verifyDescriptor: async (value) => validateAssistanceRuntimeFamilyDescriptorV1(value),
		createWorker: (entry, job) => {
			starts.push([entry, job]);
			const thread = new FakeThread(); threads.push(thread); return thread;
		},
	});
	helper.handleMessage({ protocolVersion: 1, type: 'initialize', descriptor: descriptor() });
	await until(() => messages.length === 1);
	helper.handleMessage({ protocolVersion: 1, type: 'job', request: request() });
	assert.equal(starts.length, 1);
	assert.ok(starts[0]![0] instanceof URL);
	assert.match((starts[0]![0] as URL).pathname,
		/assistance-runtime-family-inference-worker\.js$/u);
	assert.deepEqual(starts[0]![1], { ...request(), descriptor: descriptor() });
	threads[0]!.emit('message', { protocolVersion: 1, type: 'error', jobId: JOB_ID,
		familyId: 'onnxruntime-node', task: 'shot-detection',
		error: { name: 'Error', message: 'adapter unavailable', code: 'ADAPTER_UNAVAILABLE' } });
	threads[0]!.emit('exit', 0);
	await until(() => messages.length === 2);
	assert.deepEqual(messages[1], { protocolVersion: 1, type: 'error', jobId: JOB_ID,
		familyId: 'onnxruntime-node', task: 'shot-detection',
		error: { name: 'Error', message: 'adapter unavailable', code: 'ADAPTER_UNAVAILABLE' } });
	assert.deepEqual(exits, []);
});

test('the helper entry validates its private process seams', () => {
	assert.throws(() => createAssistanceRuntimeFamilyHelperProcessV1({
		post: () => undefined, exit: () => undefined,
		workerEntry: new URL('https://example.invalid/worker.js'),
	}), /entry|file|local/iu);
});

test('whisper.cpp jobs use the utility-owned terminateable CLI worker instead of a thread', async () => {
	const messages: unknown[] = [];
	let threads = 0;
	let whisperWorkers = 0;
	const helper = createAssistanceRuntimeFamilyHelperProcessV1({
		post: (message) => messages.push(message), exit: () => undefined,
		verifyDescriptor: async (value) => validateAssistanceRuntimeFamilyDescriptorV1(value),
		createWorker: () => { threads += 1; return new FakeThread(); },
		spawnWhisperWorker: () => {
			whisperWorkers += 1;
			const error = new Error('reviewed adapter stopped');
			(error as Error & { code?: string }).code = 'ADAPTER_UNAVAILABLE';
			return Object.freeze({ completion: Promise.reject(error), terminate: async () => undefined });
		},
	});
	helper.handleMessage({ protocolVersion: 1, type: 'initialize', descriptor: whisperDescriptor() });
	await until(() => messages.length === 1);
	helper.handleMessage({ protocolVersion: 1, type: 'job', request: whisperRequest() });
	await until(() => messages.length === 2);
	assert.equal(whisperWorkers, 1);
	assert.equal(threads, 0);
	assert.deepEqual(messages[1], {
		protocolVersion: 1, type: 'error', jobId: JOB_ID,
		familyId: 'whisper-cpp', task: 'speech-recognition',
		error: { name: 'Error', message: 'reviewed adapter stopped', code: 'ADAPTER_UNAVAILABLE' },
	});
});

test('llama.cpp editorial jobs use the utility-owned terminateable CLI worker instead of a thread', async () => {
	const messages: unknown[] = [];
	let threads = 0;
	let llamaWorkers = 0;
	const helper = createAssistanceRuntimeFamilyHelperProcessV1({
		post: (message) => messages.push(message), exit: () => undefined,
		verifyDescriptor: async (value) => validateAssistanceRuntimeFamilyDescriptorV1(value),
		createWorker: () => { threads += 1; return new FakeThread(); },
		spawnLlamaWorker: () => {
			llamaWorkers += 1;
			const error = new Error('reviewed editorial adapter stopped');
			(error as Error & { code?: string }).code = 'ADAPTER_UNAVAILABLE';
			return Object.freeze({ completion: Promise.reject(error), terminate: async () => undefined });
		},
	});
	helper.handleMessage({ protocolVersion: 1, type: 'initialize', descriptor: llamaDescriptor() });
	await until(() => messages.length === 1);
	helper.handleMessage({ protocolVersion: 1, type: 'job', request: llamaRequest() });
	await until(() => messages.length === 2);
	assert.equal(llamaWorkers, 1);
	assert.equal(threads, 0);
	assert.deepEqual(messages[1], {
		protocolVersion: 1, type: 'error', jobId: JOB_ID,
		familyId: 'llama-cpp', task: 'editorial-generation',
		error: { name: 'Error', message: 'reviewed editorial adapter stopped',
			code: 'ADAPTER_UNAVAILABLE' },
	});
});

async function until(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => { setTimeout(resolve, 1); });
	}
	assert.fail('The helper-process condition was not reached.');
}
