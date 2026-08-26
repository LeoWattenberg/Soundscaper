/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAssistanceRuntimeFamilyThreadWorkerSpawner,
	type AssistanceRuntimeFamilyThreadPort,
} from '../desktop/assistance-runtime-family-thread-worker.ts';

const JOB_ID = '1'.repeat(40);
const SHA = '2'.repeat(64);

function admittedJob() {
	const descriptor = {
		familyId: 'onnxruntime-node' as const, runtimeVersion: '1.29.0', target: 'linux-x64' as const,
		executionProvider: 'cpu' as const, entrypoint: '/runtime/runtime.js',
		files: [{ path: '/runtime/runtime.js', relativePath: 'runtime.js',
			byteLength: 1, sha256: SHA, executable: false }],
	};
	const grant = {
		grantVersion: 1 as const, jobId: JOB_ID, familyId: 'onnxruntime-node' as const,
		task: 'shot-detection' as const, settingsJson: '{}',
		inputs: [{ claimId: '3'.repeat(40), role: 'video' as const, mediaType: 'video/mp4',
			path: '/private/input', byteLength: 1, sha256: SHA, identity: { dev: 1, ino: 1 } }],
		models: [{ modelId: 'transnetv2', version: '1.0.0', artifactRole: 'network',
			path: '/private/model', byteLength: 1, sha256: SHA, identity: { dev: 1, ino: 2 } }],
		outputs: [{ claimId: '4'.repeat(40), role: 'shot-boundaries' as const,
			mediaType: 'application/vnd.soundscaper.shot-boundaries+json', path: '/private/output',
			maximumByteLength: 1_024, initialByteLength: 0 as const,
			initialSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
			identity: { dev: 1, ino: 3 } }],
	};
	return { protocolVersion: 1 as const, jobId: JOB_ID, familyId: 'onnxruntime-node' as const,
		task: 'shot-detection' as const, maximumRssBytes: 1024 ** 3,
		maximumDurationMs: 60_000, grant, descriptor };
}

class FakeThread implements AssistanceRuntimeFamilyThreadPort {
	terminations = 0;
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
	terminate(): Promise<number> {
		this.terminations += 1;
		queueMicrotask(() => this.emit('exit', 1));
		return Promise.resolve(1);
	}
	emit(event: string, ...values: unknown[]): void {
		for (const listener of [...this.#listeners.get(event) ?? []]) listener(...values);
	}
}

function result() {
	return { resultVersion: 1, jobId: JOB_ID, familyId: 'onnxruntime-node',
		task: 'shot-detection', outputs: [{ claimId: '4'.repeat(40), role: 'shot-boundaries',
			mediaType: 'application/vnd.soundscaper.shot-boundaries+json', byteLength: 10, sha256: SHA }] };
}

test('the thread wrapper sends only a validated admitted job and waits for worker exit', async () => {
	const threads: FakeThread[] = [];
	const starts: unknown[][] = [];
	const spawn = createAssistanceRuntimeFamilyThreadWorkerSpawner({
		workerEntry: '/app/desktop/assistance-runtime-family-inference-worker.js',
		createWorker: (entry, job) => {
			starts.push([entry, job]);
			const thread = new FakeThread(); threads.push(thread); return thread;
		},
	});
	const progress: number[] = [];
	const job = admittedJob();
	const worker = spawn(job, { onProgress: (value) => progress.push(value) });
	assert.deepEqual(starts, [[
		'/app/desktop/assistance-runtime-family-inference-worker.js', job,
	]]);
	threads[0]!.emit('message', { protocolVersion: 1, type: 'progress', jobId: JOB_ID,
		familyId: 'onnxruntime-node', task: 'shot-detection', sequence: 0, value: 0.4 });
	threads[0]!.emit('message', { protocolVersion: 1, type: 'result', jobId: JOB_ID,
		familyId: 'onnxruntime-node', task: 'shot-detection', result: result() });
	let settled = false;
	void worker.completion.then(() => { settled = true; });
	await Promise.resolve();
	assert.equal(settled, false);
	threads[0]!.emit('exit', 0);
	assert.deepEqual(await worker.completion, result());
	assert.deepEqual(progress, [0.4]);
});

test('malformed, duplicate, or out-of-sequence messages terminate the isolated thread', async () => {
	for (const message of [
		{ protocolVersion: 1, type: 'progress', jobId: JOB_ID,
			familyId: 'onnxruntime-node', task: 'shot-detection', sequence: 2, value: 0.4 },
		{ type: 'shell', command: '/bin/sh' },
	]) {
		const thread = new FakeThread();
		const spawn = createAssistanceRuntimeFamilyThreadWorkerSpawner({
			workerEntry: '/app/desktop/assistance-runtime-family-inference-worker.js',
			createWorker: () => thread,
		});
		const worker = spawn(admittedJob(), { onProgress: () => undefined });
		thread.emit('message', message);
		await assert.rejects(worker.completion, /protocol|progress|message|worker/iu);
		assert.equal(thread.terminations, 1);
	}
});

test('per-job termination resolves only after worker termination and rejects completion as aborted', async () => {
	const thread = new FakeThread();
	const spawn = createAssistanceRuntimeFamilyThreadWorkerSpawner({
		workerEntry: new URL('file:///app/desktop/assistance-runtime-family-inference-worker.js'),
		createWorker: () => thread,
	});
	const worker = spawn(admittedJob(), { onProgress: () => undefined });
	const completion = assert.rejects(worker.completion, (error: Error) => error.name === 'AbortError');
	await worker.terminate();
	assert.equal(thread.terminations, 1);
	await completion;
});
