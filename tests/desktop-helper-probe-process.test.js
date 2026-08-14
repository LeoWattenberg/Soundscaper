/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';

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

test('helper worker acknowledges cancellation immediately and terminates the engine job', () => {
	const { worker, posted, engineJobs } = createControlHarness();
	worker.handleMessage(structuredClone(JOB_MESSAGE));
	worker.handleMessage({ contractVersion: 1, type: 'cancel', jobId: JOB_ID });
	assert.deepEqual(posted.at(-1), { contractVersion: 1, type: 'cancelled', jobId: JOB_ID });
	assert.equal(engineJobs[0].record.cancelCalls, 1);
	// A late engine settlement after cancellation must not resurrect the job.
	engineJobs[0].record.settle.resolve({ probed: true });
	assert.notEqual(posted.at(-1).type, 'result');
});

test('helper worker fails closed on a host message that violates the contract', () => {
	const { worker, exits } = createControlHarness();
	worker.handleMessage({ contractVersion: 1, type: 'exec', command: 'rm' });
	assert.deepEqual(exits, [1]);
	const shutdown = createControlHarness();
	shutdown.worker.handleMessage({ contractVersion: 1, type: 'shutdown' });
	assert.deepEqual(shutdown.exits, [0]);
});

test('engine thread runner resolves results, rejects crashes, and terminates on cancel', async () => {
	class FakeWorker extends EventEmitter {
		static instances = [];
		terminations = 0;

		constructor(moduleUrl, options) {
			super();
			this.moduleUrl = moduleUrl;
			this.options = options;
			FakeWorker.instances.push(this);
		}

		terminate() {
			this.terminations += 1;
			return Promise.resolve(0);
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
	cancelled.cancel();
	assert.equal(FakeWorker.instances.at(-1).terminations, 1, 'cancel must terminate the engine thread immediately');
});
