/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';

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
			path: '/private/input', byteLength: 1, sha256: SHA, identity: { dev: '1', ino: '1' } }],
		models: [{ modelId: 'transnetv2', version: '1.0.0', artifactRole: 'network',
			path: '/private/model', byteLength: 1, sha256: SHA, identity: { dev: '1', ino: '2' } }],
		outputs: [{ claimId: '4'.repeat(40), role: 'shot-boundaries' as const,
			mediaType: 'application/vnd.soundscaper.shot-boundaries+json', path: '/private/output',
			maximumByteLength: 1_024, initialByteLength: 0 as const,
			initialSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
			identity: { dev: '1', ino: '3' } }],
	};
	return { protocolVersion: 1 as const, jobId: JOB_ID, familyId: 'onnxruntime-node' as const,
		task: 'shot-detection' as const, maximumRssBytes: 1024 ** 3,
		maximumDurationMs: 60_000, grant, descriptor };
}

class FakeThread implements AssistanceRuntimeFamilyThreadPort {
	terminations = 0;
	readonly posted: unknown[] = [];
	postMessage(value: unknown): void { this.posted.push(value); }
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


function message(type: string, current = admittedJob()) {
	return { protocolVersion: 1, type, jobId: current.jobId, familyId: current.familyId, task: current.task,
		...(type === 'result' ? { result: { ...result(), jobId: current.jobId } } : {}) };
}
function idle(thread: FakeThread, current = admittedJob(), reusable = true): void {
	thread.emit('message', { type: 'resident-idle', jobId: current.jobId, reusable });
}
function fixture() {
	const threads: FakeThread[] = [], residence: boolean[] = [];
	const spawn = createAssistanceRuntimeFamilyThreadWorkerSpawner({ residentOnnx: true,
		workerEntry: '/app/desktop/assistance-runtime-family-inference-worker.js',
		createWorker: (_entry, _job, resident) => { residence.push(resident === true); const thread = new FakeThread(); threads.push(thread); return thread; },
	});
	return { threads, residence, spawn };
}

test('resident ONNX completes only after the authenticated idle handshake and reuses a single serial thread', async () => {
	const { threads, residence, spawn } = fixture();
	const first = spawn(admittedJob(), { onProgress() {} });
	assert.throws(() => spawn(admittedJob(), { onProgress() {} }), /already active/iu);
	await tick();
	threads[0]!.emit('message', message('result'));
	let settled = false;
	void first.completion.then(() => { settled = true; });
	await tick(); assert.equal(settled, false);
	idle(threads[0]!); await first.completion;
	const next = admittedJob(); next.jobId = '5'.repeat(40); next.grant.jobId = next.jobId;
	const second = spawn(next, { onProgress() {} });
	await tick();
	assert.equal(threads.length, 1); assert.deepEqual(residence, [true]);
	assert.deepEqual(threads[0]!.posted, [{ type: 'resident-run', job: next }]);
	threads[0]!.emit('message', message('result', next)); idle(threads[0]!, next);
	assert.deepEqual(await second.completion, { ...result(), jobId: next.jobId });
	threads[0]!.emit('exit', 0);
});

test('resident model changes retire the old thread before starting a fresh authenticated scope', async () => {
	const { threads, spawn } = fixture();
	const first = spawn(admittedJob(), { onProgress() {} }); await tick();
	threads[0]!.emit('message', message('result')); idle(threads[0]!); await first.completion;
	const changed = admittedJob(); changed.grant.models[0]!.sha256 = '6'.repeat(64);
	const second = spawn(changed, { onProgress() {} }); await tick();
	assert.equal(threads[0]!.terminations, 1); assert.equal(threads.length, 2);
	threads[1]!.emit('message', message('result', changed)); idle(threads[1]!, changed, false);
	let settled = false; void second.completion.then(() => { settled = true; });
	await tick(); assert.equal(settled, false);
	threads[1]!.emit('exit', 0); await second.completion;
});

test('malformed or duplicated resident completion handshakes hard-retire the native lease', async () => {
	for (const invalid of [
		{ type: 'resident-idle', jobId: '8'.repeat(40), reusable: true },
		{ type: 'resident-idle', jobId: JOB_ID, reusable: true, extra: true },
		message('result'),
	]) {
		const { threads, spawn } = fixture(); const worker = spawn(admittedJob(), { onProgress() {} });
		const rejected = assert.rejects(worker.completion, /protocol|handshake/iu); await tick();
		threads[0]!.emit('message', message('result')); threads[0]!.emit('message', invalid);
		await rejected; assert.equal(threads[0]!.terminations, 1);
	}
});

test('resident cancellation retires a started thread and prevents a queued worker from being created', async () => {
	for (const started of [false, true]) {
		const { threads, spawn } = fixture(); const worker = spawn(admittedJob(), { onProgress() {} });
		const rejected = assert.rejects(worker.completion, (error: Error) => error.name === 'AbortError');
		if (started) await tick();
		await worker.terminate(); await rejected;
		assert.equal(threads.length, Number(started));
		if (started) assert.equal(threads[0]!.terminations, 1);
	}
});
