/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';

import { MAXIMUM_HELPER_WIRE_MESSAGE_BYTES } from '../desktop/helper-contract.ts';
import {
	createEngineThreadJobRunner,
	createHelperProbeWorker,
} from '../desktop/helper-probe-process.js';

const JOB_ID = 'ab'.repeat(20);

const JOB_MESSAGE = Object.freeze({
	contractVersion: 1,
	type: 'job',
	jobId: JOB_ID,
	kind: 'probe-video-source',
	grant: { mediaPath: '/media/example.mp4', mediaBytes: 64, identity: { dev: 1, ino: 2 } },
	resourcePolicy: {
		maximumInputBytes: 1024 ** 3,
		maximumJobDurationMs: 60_000,
		maximumRssBytes: 1024 ** 3,
	},
});

function createControlHarness({ engine } = {}) {
	const posted = [];
	const exits = [];
	const intervals = [];
	const engineJobs = [];
	const worker = createHelperProbeWorker({
		post: (message) => posted.push(message),
		runEngineJob: (job) => {
			engineJobs.push(job);
			if (engine) return engine(job);
			let settle;
			const completion = new Promise((resolve, reject) => {
				settle = { resolve, reject };
			});
			const record = { cancelCalls: 0, settle };
			engineJobs.at(-1).record = record;
			return {
				completion,
				cancel: () => {
					record.cancelCalls += 1;
					return Promise.resolve();
				},
			};
		},
		setIntervalImpl: (handler, delay) => {
			intervals.push({ handler, delay });
			return { unref: () => {} };
		},
		clearIntervalImpl: () => {},
		exit: (code) => exits.push(code),
	});
	return { worker, posted, exits, intervals, engineJobs };
}

test('helper worker greets with the contract handshake and heartbeats with the active job id', () => {
	const { worker, posted, intervals } = createControlHarness();
	assert.deepEqual(posted[0], { contractVersion: 1, type: 'hello', kinds: ['probe-video-source'] });
	assert.equal(intervals.length, 1);
	intervals[0].handler();
	assert.deepEqual(posted.at(-1), { contractVersion: 1, type: 'heartbeat', jobId: null });
	worker.handleMessage(structuredClone(JOB_MESSAGE));
	intervals[0].handler();
	assert.deepEqual(posted.at(-1), { contractVersion: 1, type: 'heartbeat', jobId: JOB_ID });
});

test('helper worker runs one job, posts its result, and refuses a concurrent second job', async () => {
	const { worker, posted, engineJobs } = createControlHarness();
	worker.handleMessage(structuredClone(JOB_MESSAGE));
	assert.equal(engineJobs.length, 1);
	assert.equal(engineJobs[0].grant.mediaPath, '/media/example.mp4');
	const second = { ...structuredClone(JOB_MESSAGE), jobId: 'cd'.repeat(20) };
	worker.handleMessage(second);
	const refusal = posted.at(-1);
	assert.equal(refusal.type, 'error');
	assert.equal(refusal.jobId, 'cd'.repeat(20));
	assert.match(refusal.error.message, /one job at a time/u);
	engineJobs[0].record.settle.resolve({ probed: true });
	await new Promise((resolve) => setImmediate(resolve));
	const result = posted.at(-1);
	assert.equal(result.type, 'result');
	assert.equal(result.jobId, JOB_ID);
	assert.deepEqual(result.result, { probed: true });
});

test('helper worker posts a structured error when the engine fails', async () => {
	const { worker, posted, engineJobs } = createControlHarness();
	worker.handleMessage(structuredClone(JOB_MESSAGE));
	const failure = new Error('The granted media file no longer matches its captured identity.');
	failure.code = 'HELPER_GRANT_IDENTITY_MISMATCH';
	engineJobs[0].record.settle.reject(failure);
	await new Promise((resolve) => setImmediate(resolve));
	const error = posted.at(-1);
	assert.equal(error.type, 'error');
	assert.equal(error.jobId, JOB_ID);
	assert.equal(error.error.code, 'HELPER_GRANT_IDENTITY_MISMATCH');
});

test('helper worker validates a result before it reaches the process post seam', async () => {
	const { worker, posted, exits, engineJobs } = createControlHarness();
	worker.handleMessage(structuredClone(JOB_MESSAGE));
	engineJobs[0].record.settle.resolve({ payload: 'x'.repeat(MAXIMUM_HELPER_WIRE_MESSAGE_BYTES) });
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(exits, [1]);
	assert.equal(posted.some((message) => message.type === 'result'), false,
		'an oversized engine result must be refused before Electron clones it into main');
});

test('helper worker forwards bounded engine progress only for its active generation', async () => {
	let reportProgress;
	let finishCancellation;
	const cancellation = new Promise((resolve) => {
		finishCancellation = resolve;
	});
	const { worker, posted } = createControlHarness({
		engine: ({ onProgress }) => {
			reportProgress = onProgress;
			return { completion: new Promise(() => {}), cancel: () => cancellation };
		},
	});
	worker.handleMessage(structuredClone(JOB_MESSAGE));
	for (const value of [0, null, 1]) reportProgress(value);
	assert.deepEqual(posted.slice(-3).map((message) => message.value), [0, null, 1]);

	worker.handleMessage({ contractVersion: 1, type: 'cancel', jobId: JOB_ID });
	const beforeLateProgress = posted.length;
	reportProgress(0.5);
	assert.equal(posted.length, beforeLateProgress, 'a cancelling generation cannot publish late progress');
	finishCancellation();
	await new Promise((resolve) => setImmediate(resolve));
});

test('helper worker acknowledges cancellation only after engine quiescence and admits no overlap', async () => {
	let finishCancellation;
	let finishEngine;
	const cancellation = new Promise((resolve) => {
		finishCancellation = resolve;
	});
	const { worker, posted, engineJobs } = createControlHarness({
		engine: () => {
			const completion = new Promise((resolve) => {
				finishEngine = resolve;
			});
			return {
				completion,
				cancel: () => cancellation,
			};
		},
	});
	worker.handleMessage(structuredClone(JOB_MESSAGE));
	worker.handleMessage({ contractVersion: 1, type: 'cancel', jobId: JOB_ID });
	assert.notEqual(posted.at(-1).type, 'cancelled', 'acknowledgement must wait for worker termination');

	const second = { ...structuredClone(JOB_MESSAGE), jobId: 'cd'.repeat(20) };
	worker.handleMessage(second);
	assert.equal(engineJobs.length, 1, 'a cancelling engine may not overlap a replacement job');
	assert.equal(posted.at(-1).type, 'error');
	assert.equal(posted.at(-1).jobId, second.jobId);

	// A late engine settlement after cancellation must not resurrect the job.
	finishEngine({ probed: true });
	finishCancellation();
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(posted.at(-1), { contractVersion: 1, type: 'cancelled', jobId: JOB_ID });
	assert.notEqual(posted.at(-1).type, 'result');

	worker.handleMessage(second);
	assert.equal(engineJobs.length, 2, 'the next engine may start after cancellation quiesces');
});

test('helper worker fails closed on a host message that violates the contract', () => {
	const { worker, exits } = createControlHarness();
	worker.handleMessage({ contractVersion: 1, type: 'exec', command: 'rm' });
	assert.deepEqual(exits, [1]);
	const shutdown = createControlHarness();
	shutdown.worker.handleMessage({ contractVersion: 1, type: 'shutdown' });
	assert.deepEqual(shutdown.exits, [0]);
});

test('probe helper refuses a globally known job kind it did not advertise', () => {
	const { worker, exits, engineJobs } = createControlHarness();
	worker.handleMessage({
		contractVersion: 1,
		type: 'job',
		jobId: JOB_ID,
		kind: 'audio-device',
		grant: {
			backend: 'coreaudio',
			deviceHandle: 'main-owned-default-device',
			direction: 'duplex',
			mode: 'shared',
		},
		resourcePolicy: {
			maximumInputBytes: 1024 ** 3,
			maximumJobDurationMs: 60_000,
			maximumRssBytes: 1024 ** 3,
			allowNetwork: false,
			allowChildProcesses: false,
			allowOutputFiles: false,
		},
	});
	assert.equal(engineJobs.length, 0);
	assert.deepEqual(exits, [1]);
});

test('helper worker contains synchronous engine startup and protocol failures', async () => {
	const startup = createControlHarness({
		engine: () => {
			throw new Error('worker construction failed');
		},
	});
	assert.doesNotThrow(() => startup.worker.handleMessage(structuredClone(JOB_MESSAGE)));
	assert.deepEqual(startup.exits, [1]);

	const protocolError = new TypeError('malformed worker output');
	protocolError.code = 'HELPER_ENGINE_PROTOCOL_VIOLATION';
	const protocol = createControlHarness({
		engine: () => ({
			completion: Promise.reject(protocolError),
			cancel: () => Promise.resolve(),
		}),
	});
	protocol.worker.handleMessage(structuredClone(JOB_MESSAGE));
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(protocol.exits, [1]);
	assert.equal(protocol.posted.some((message) => message.type === 'error'), false,
		'a worker protocol violation must exit so main records a qualifying helper fault');
});

test('engine thread runner resolves results, rejects crashes, and awaits termination on cancel', async () => {
	class FakeWorker extends EventEmitter {
		static instances = [];
		terminations = 0;
		termination = Promise.resolve(0);

		constructor(moduleUrl, options) {
			super();
			this.moduleUrl = moduleUrl;
			this.options = options;
			FakeWorker.instances.push(this);
		}

		terminate() {
			this.terminations += 1;
			return this.termination;
		}
	}
	const runner = createEngineThreadJobRunner({
		engineModuleUrl: new URL('file:///engine.js'),
		engineConfig: { pinned: true },
		WorkerImpl: FakeWorker,
	});
	const success = runner({ grant: JOB_MESSAGE.grant, resourcePolicy: JOB_MESSAGE.resourcePolicy });
	const successWorker = FakeWorker.instances.at(-1);
	assert.deepEqual(successWorker.options.workerData.engineConfig, { pinned: true });
	successWorker.emit('message', { ok: true, result: { probed: true } });
	assert.deepEqual(await success.completion, { probed: true });
	assert.equal(successWorker.terminations, 1, 'a settled engine thread is always terminated');

	const progress = [];
	const progressing = runner({
		grant: JOB_MESSAGE.grant,
		resourcePolicy: JOB_MESSAGE.resourcePolicy,
		onProgress: (value) => progress.push(value),
	});
	const progressWorker = FakeWorker.instances.at(-1);
	for (const value of [0, null, 1]) progressWorker.emit('message', { type: 'progress', value });
	assert.deepEqual(progress, [0, null, 1]);
	progressWorker.emit('message', { ok: true, result: 'done' });
	assert.equal(await progressing.completion, 'done');

	const malformedProgress = runner({ grant: JOB_MESSAGE.grant, resourcePolicy: JOB_MESSAGE.resourcePolicy });
	const malformedProgressWorker = FakeWorker.instances.at(-1);
	malformedProgressWorker.emit('message', { type: 'progress', value: 1.01 });
	await assert.rejects(malformedProgress.completion, (error) => (
		error.code === 'HELPER_ENGINE_PROTOCOL_VIOLATION' && /malformed progress/u.test(error.message)
	));
	assert.equal(malformedProgressWorker.terminations, 1);

	const engineError = runner({ grant: JOB_MESSAGE.grant, resourcePolicy: JOB_MESSAGE.resourcePolicy });
	FakeWorker.instances.at(-1).emit('message', {
		ok: false, name: 'RangeError', message: 'bad media', code: 'HELPER_ENGINE_BINARY_MISMATCH',
	});
	await assert.rejects(engineError.completion, (error) => (
		error.name === 'RangeError' && error.code === 'HELPER_ENGINE_BINARY_MISMATCH'
	));

	const crashed = runner({ grant: JOB_MESSAGE.grant, resourcePolicy: JOB_MESSAGE.resourcePolicy });
	FakeWorker.instances.at(-1).emit('exit', 134);
	await assert.rejects(crashed.completion, /exited with code 134/u);

	const cancelled = runner({ grant: JOB_MESSAGE.grant, resourcePolicy: JOB_MESSAGE.resourcePolicy });
	let finishTermination;
	FakeWorker.instances.at(-1).termination = new Promise((resolve) => {
		finishTermination = resolve;
	});
	let quiesced = false;
	const cancelling = cancelled.cancel().then(() => {
		quiesced = true;
	});
	assert.equal(FakeWorker.instances.at(-1).terminations, 1, 'cancel must terminate the engine thread immediately');
	await Promise.resolve();
	assert.equal(quiesced, false, 'cancel must not settle before thread termination');
	finishTermination(0);
	await cancelling;
	assert.equal(quiesced, true);
});
