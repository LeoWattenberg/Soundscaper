/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAssistanceRuntimeFamilyUtilityWorker,
	type AssistanceRuntimeFamilyInnerWorker,
} from '../desktop/assistance-runtime-family-utility-worker.ts';
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

function request(jobId = JOB_ID) {
	return {
		protocolVersion: 1, jobId, familyId: 'onnxruntime-node', task: 'shot-detection',
		maximumRssBytes: 1024 ** 3, maximumDurationMs: 60_000,
		grant: {
			grantVersion: 1, jobId, familyId: 'onnxruntime-node', task: 'shot-detection',
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

class FakeInnerWorker implements AssistanceRuntimeFamilyInnerWorker {
	readonly completion: Promise<unknown>;
	terminations = 0;
	#resolve!: (value: unknown) => void;
	#reject!: (error: Error) => void;
	constructor() {
		this.completion = new Promise((resolve, reject) => {
			this.#resolve = resolve; this.#reject = reject;
		});
	}
	resolve(value: unknown): void { this.#resolve(value); }
	reject(error: Error): void { this.#reject(error); }
	terminate(): Promise<void> { this.terminations += 1; return Promise.resolve(); }
}

function harness() {
	const messages: unknown[] = [];
	const exits: number[] = [];
	const workers: FakeInnerWorker[] = [];
	let progress: ((value: number) => void) | null = null;
	const worker = createAssistanceRuntimeFamilyUtilityWorker({
		post: (message) => messages.push(message),
		exit: (code) => exits.push(code),
		verifyDescriptor: async (value) => validateAssistanceRuntimeFamilyDescriptorV1(value),
		spawnWorker: (_job, options) => {
			progress = options.onProgress;
			const child = new FakeInnerWorker(); workers.push(child); return child;
		},
	});
	return { worker, messages, exits, workers, publishProgress: (value: number) => progress?.(value) };
}

async function initialize(rig: ReturnType<typeof harness>): Promise<void> {
	rig.worker.handleMessage({ protocolVersion: 1, type: 'initialize', descriptor: descriptor() });
	await until(() => rig.messages.length === 1 || rig.exits.length > 0);
	assert.deepEqual(rig.messages[0], {
		protocolVersion: 1, type: 'ready', familyId: 'onnxruntime-node', runtimeVersion: '1.29.0',
	});
}

test('the utility process authenticates once, then runs one family-bound worker with strict progress/result messages', async () => {
	const rig = harness();
	await initialize(rig);
	rig.worker.handleMessage({ protocolVersion: 1, type: 'job', request: request() });
	assert.equal(rig.workers.length, 1);
	rig.publishProgress(0.5);
	assert.deepEqual(rig.messages[1], {
		protocolVersion: 1, type: 'progress', jobId: JOB_ID,
		familyId: 'onnxruntime-node', task: 'shot-detection', sequence: 0, value: 0.5,
	});
	const result = { resultVersion: 1, jobId: JOB_ID, familyId: 'onnxruntime-node',
		task: 'shot-detection', outputs: [{ claimId: '4'.repeat(40), role: 'shot-boundaries',
			mediaType: 'application/vnd.soundscaper.shot-boundaries+json', byteLength: 10, sha256: SHA }] };
	rig.workers[0]!.resolve(result);
	await until(() => rig.messages.length === 3);
	assert.deepEqual(rig.messages[2], {
		protocolVersion: 1, type: 'result', jobId: JOB_ID,
		familyId: 'onnxruntime-node', task: 'shot-detection', result,
	});
	assert.deepEqual(rig.exits, []);
});

test('terminate-worker acknowledges only after the per-job worker terminates', async () => {
	const rig = harness();
	await initialize(rig);
	rig.worker.handleMessage({ protocolVersion: 1, type: 'job', request: request() });
	rig.worker.handleMessage({ protocolVersion: 1, type: 'terminate-worker', jobId: JOB_ID });
	await until(() => rig.messages.length === 2);
	assert.equal(rig.workers[0]!.terminations, 1);
	assert.deepEqual(rig.messages[1], {
		protocolVersion: 1, type: 'worker-terminated', jobId: JOB_ID,
		familyId: 'onnxruntime-node', task: 'shot-detection',
	});
	rig.workers[0]!.reject(new DOMException('terminated', 'AbortError'));
	await Promise.resolve();
	assert.deepEqual(rig.exits, []);
});

test('foreign, concurrent, malformed, or pre-initialize work fails the containing utility process closed', async () => {
	for (const action of [
		(rig: ReturnType<typeof harness>) => rig.worker.handleMessage({
			protocolVersion: 1, type: 'job', request: request(),
		}),
		(rig: ReturnType<typeof harness>) => {
			rig.worker.handleMessage({ protocolVersion: 1, type: 'initialize', descriptor: descriptor() });
			rig.worker.handleMessage({ protocolVersion: 1, type: 'initialize', descriptor: descriptor() });
		},
		(rig: ReturnType<typeof harness>) => rig.worker.handleMessage({ protocolVersion: 1, type: 'shell' }),
	]) {
		const rig = harness(); action(rig);
		await until(() => rig.exits.length > 0);
		assert.deepEqual(rig.exits, [1]);
	}
});

async function until(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => { setTimeout(resolve, 1); });
	}
	assert.fail('The utility-worker condition was not reached.');
}
