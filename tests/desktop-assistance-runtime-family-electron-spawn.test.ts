/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAssistanceRuntimeFamilyElectronSpawns,
	type AssistanceRuntimeFamilyElectronChild,
} from '../desktop/assistance-runtime-family-electron-spawn.ts';

const JOB_ID = '1'.repeat(40);
const SHA = '2'.repeat(64);

function descriptor() {
	return {
		familyId: 'onnxruntime-node' as const, runtimeVersion: '1.29.0', target: 'linux-x64' as const,
		executionProvider: 'cpu' as const, entrypoint: '/runtime/runtime.js',
		files: [{ path: '/runtime/runtime.js', relativePath: 'runtime.js',
			byteLength: 1, sha256: SHA, executable: false }],
	};
}

function request() {
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
		maximumDurationMs: 60_000, grant };
}

class FakeChild implements AssistanceRuntimeFamilyElectronChild {
	readonly pid = 123;
	readonly sent: unknown[] = [];
	kills = 0;
	emitExitOnKill = true;
	readonly #listeners = new Map<string, Set<(...values: unknown[]) => void>>();
	postMessage(message: unknown): void { this.sent.push(message); }
	on(event: string, listener: (...values: unknown[]) => void): void {
		const listeners = this.#listeners.get(event) ?? new Set();
		listeners.add(listener); this.#listeners.set(event, listeners);
	}
	off(event: string, listener: (...values: unknown[]) => void): void {
		this.#listeners.get(event)?.delete(listener);
	}
	kill(): void { this.kills += 1; if (this.emitExitOnKill) this.emit('exit', 0); }
	emit(event: string, ...values: unknown[]): void {
		for (const listener of this.#listeners.get(event) ?? []) listener(...values);
	}
}

function harness(overrides: Record<string, unknown> = {}) {
	const children: FakeChild[] = [];
	const calls: unknown[][] = [];
	const spawns = createAssistanceRuntimeFamilyElectronSpawns({
		helperPath: '/app/assistance-runtime-family-helper-process.js',
		fork: (...values) => {
			calls.push(values);
			const child = new FakeChild(); children.push(child); return child;
		},
		sampleRss: (pid) => pid === 123 ? 50_000 : null,
		handshakeTimeoutMs: 50,
		killWaitMs: 50,
		...overrides,
	});
	return { spawns, children, calls };
}

async function spawnReady(rig: ReturnType<typeof harness>) {
	const spawning = rig.spawns['onnxruntime-node'](descriptor());
	await until(() => rig.children.length === 1 && rig.children[0]!.sent.length === 1);
	const child = rig.children[0]!;
	assert.deepEqual(child.sent[0], { protocolVersion: 1, type: 'initialize', descriptor: descriptor() });
	child.emit('spawn');
	child.emit('message', {
		protocolVersion: 1, type: 'ready', familyId: 'onnxruntime-node', runtimeVersion: '1.29.0',
	});
	return { process: await spawning, child };
}

test('Electron spawns a distinct named family process and completes strict progress/results', async () => {
	const rig = harness();
	const { process, child } = await spawnReady(rig);
	assert.deepEqual(rig.calls[0], [
		'/app/assistance-runtime-family-helper-process.js', [],
		{ serviceName: 'soundscaper-assistance-onnxruntime-node' },
	]);
	assert.equal(process.familyId, 'onnxruntime-node');
	assert.equal(process.runtimeVersion, '1.29.0');
	assert.equal(process.sampleRss(), 50_000);
	const progress: number[] = [];
	const job = process.startWorker({ ...request(), descriptor: descriptor() }, {
		onProgress: (value) => progress.push(value),
	});
	assert.deepEqual(child.sent[1], { protocolVersion: 1, type: 'job', request: request() });
	child.emit('message', { protocolVersion: 1, type: 'progress', jobId: JOB_ID,
		familyId: 'onnxruntime-node', task: 'shot-detection', sequence: 0, value: 0.5 });
	const result = { resultVersion: 1, jobId: JOB_ID, familyId: 'onnxruntime-node',
		task: 'shot-detection', outputs: [{ claimId: '4'.repeat(40), role: 'shot-boundaries',
			mediaType: 'application/vnd.soundscaper.shot-boundaries+json', byteLength: 10, sha256: SHA }] };
	child.emit('message', { protocolVersion: 1, type: 'result', jobId: JOB_ID,
		familyId: 'onnxruntime-node', task: 'shot-detection', result });
	assert.deepEqual(await job.completion, result);
	assert.deepEqual(progress, [0.5]);
});

test('per-job termination waits for worker-terminated without killing the reusable family process', async () => {
	const rig = harness();
	const { process, child } = await spawnReady(rig);
	const job = process.startWorker({ ...request(), descriptor: descriptor() }, {});
	const terminating = job.terminate();
	assert.deepEqual(child.sent[2], { protocolVersion: 1, type: 'terminate-worker', jobId: JOB_ID });
	let settled = false;
	void terminating.then(() => { settled = true; });
	await Promise.resolve();
	assert.equal(settled, false);
	child.emit('message', { protocolVersion: 1, type: 'worker-terminated', jobId: JOB_ID,
		familyId: 'onnxruntime-node', task: 'shot-detection' });
	await terminating;
	await assert.rejects(job.completion, (error: Error) => error.name === 'AbortError');
	assert.equal(child.kills, 0);
});

test('termination kills and settles when a worker never acknowledges and its process never exits', async () => {
	const rig = harness({ killWaitMs: 5 });
	const { process, child } = await spawnReady(rig);
	child.emitExitOnKill = false;
	const job = process.startWorker({ ...request(), descriptor: descriptor() }, {});
	await assert.rejects(job.terminate(), /termination|deadline/iu);
	await assert.rejects(job.completion, /termination|deadline/iu);
	assert.equal(child.kills, 1, 'the missing worker acknowledgement kills its family process');
	await assert.rejects(process.terminate(), /kill deadline/iu);
	assert.equal(child.kills, 2, 'process termination retries the kill before its bounded failure');
});

test('malformed or stale child messages kill the family process and reject active work', async () => {
	const rig = harness();
	const { process, child } = await spawnReady(rig);
	const job = process.startWorker({ ...request(), descriptor: descriptor() }, {});
	child.emit('message', { protocolVersion: 1, type: 'progress', jobId: JOB_ID,
		familyId: 'onnxruntime-node', task: 'shot-detection', sequence: 4, value: 0.5 });
	await assert.rejects(job.completion, /protocol|sequence/iu);
	assert.equal(child.kills, 1);
});

test('handshake mismatch and timeout never expose a process to the family router', async () => {
	const mismatch = harness();
	const wrong = mismatch.spawns['onnxruntime-node'](descriptor());
	await until(() => mismatch.children.length === 1);
	mismatch.children[0]!.emit('message', {
		protocolVersion: 1, type: 'ready', familyId: 'whisper-cpp', runtimeVersion: 'v1.9.3',
	});
	await assert.rejects(wrong, /family|handshake/iu);
	assert.equal(mismatch.children[0]!.kills, 1);

	const timeout = harness({ handshakeTimeoutMs: 5 });
	await assert.rejects(timeout.spawns['onnxruntime-node'](descriptor()), /handshake|timeout/iu);
	assert.equal(timeout.children[0]!.kills, 1);
});

test('process termination resolves on Electron exit and forwards one normalized exit event', async () => {
	const rig = harness();
	const { process, child } = await spawnReady(rig);
	const exits: Array<number | null> = [];
	process.onExit((code) => exits.push(code));
	await process.terminate();
	assert.deepEqual(exits, [0]);
	assert.equal(child.kills, 1);
});

async function until(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => { setTimeout(resolve, 1); });
	}
	assert.fail('The Electron spawn condition was not reached.');
}

test('the spawned inference process is dropped to background priority as soon as it exists', async () => {
	const priorities: number[] = [];
	const rig = harness({ applyBackgroundPriority: (pid: number) => priorities.push(pid) });
	await spawnReady(rig);
	assert.deepEqual(priorities, [123]);
});

test('an Electron child without a pid is admitted until its spawn event publishes one', async () => {
	const child = new FakeChild();
	(child as unknown as { pid: number | undefined }).pid = undefined;
	const priorities: number[] = [];
	const rssPids: number[] = [];
	const spawns = createAssistanceRuntimeFamilyElectronSpawns({
		helperPath: '/app/assistance-runtime-family-helper-process.js',
		fork: () => child,
		applyBackgroundPriority: (pid) => priorities.push(pid),
		sampleRss: (pid) => { rssPids.push(pid); return 42; },
		handshakeTimeoutMs: 50,
	});
	const spawning = spawns['onnxruntime-node'](descriptor());
	assert.deepEqual(priorities, []);
	(child as unknown as { pid: number | undefined }).pid = 456;
	child.emit('spawn');
	assert.deepEqual(priorities, [456]);
	child.emit('message', {
		protocolVersion: 1, type: 'ready', familyId: 'onnxruntime-node', runtimeVersion: '1.29.0',
	});
	const process = await spawning;
	assert.equal(process.sampleRss(), 42);
	assert.deepEqual(rssPids, [456]);
});

test('an operating system that refuses background priority still yields a usable process', async () => {
	const rig = harness({
		applyBackgroundPriority: () => { throw new Error('EPERM'); },
	});
	const { process } = await spawnReady(rig);
	assert.equal(process.familyId, 'onnxruntime-node');
	assert.equal(rig.children[0]!.kills, 0);
});

test('the spawn refuses a background-priority hook that is not callable', () => {
	assert.throws(() => harness({ applyBackgroundPriority: 'low' }), TypeError);
});
