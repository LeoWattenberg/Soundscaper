/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAssistanceHelperWorker } from '../desktop/assistance-helper-process.js';

const JOB_ID = 'ab'.repeat(20);

test('the assistance utility process advertises only native speech', async () => {
	const posted = [];
	const worker = createAssistanceHelperWorker({
		post: (message) => posted.push(message),
		runJob: () => ({ completion: Promise.resolve({ available: false, reason: null, moduleId: 'sherpa-onnx-node' }), cancel: async () => {} }),
		setIntervalImpl: () => ({ unref() {} }),
		clearIntervalImpl: () => {},
	});
	assert.deepEqual(posted[0], { contractVersion: 1, type: 'hello', kinds: ['assistance-speech'] });
	worker.handleMessage({
		contractVersion: 1,
		type: 'job',
		jobId: JOB_ID,
		kind: 'assistance-speech',
		jobContractVersion: 1,
		grant: { operation: 'status', moduleId: 'sherpa-onnx-node' },
		resourcePolicy: { maximumInputBytes: 1, maximumJobDurationMs: 1, maximumRssBytes: 1 },
	});
	await Promise.resolve();
	assert.equal(posted.at(-1).type, 'result');
	worker.dispose();
});

test('the speech process refuses audio, media, and plug-in roles', () => {
	for (const kind of ['audio-device', 'plugin-scan', 'plugin-host', 'media-render', 'ofx-host']) {
		const exits = [];
		const worker = createAssistanceHelperWorker({
			post: () => {},
			runJob: () => { throw new Error('wrong role reached inference'); },
			setIntervalImpl: () => ({ unref() {} }), clearIntervalImpl: () => {}, exit: (code) => exits.push(code),
		});
		worker.handleMessage({ contractVersion: 1, type: 'job', jobId: JOB_ID, kind });
		assert.deepEqual(exits, [1]);
	}
});

test('the speech process acknowledges cancellation only after its runner is quiescent', async () => {
	const posted = [];
	let releaseCancellation;
	const cancellation = new Promise((resolve) => { releaseCancellation = resolve; });
	const worker = createAssistanceHelperWorker({
		post: (message) => posted.push(message),
		runJob: () => ({
			completion: new Promise(() => {}),
			cancel: () => cancellation,
		}),
		setIntervalImpl: () => ({ unref() {} }),
		clearIntervalImpl: () => {},
	});
	worker.handleMessage({
		contractVersion: 1,
		type: 'job',
		jobId: JOB_ID,
		kind: 'assistance-speech',
		jobContractVersion: 1,
		grant: { operation: 'status', moduleId: 'sherpa-onnx-node' },
		resourcePolicy: { maximumInputBytes: 1, maximumJobDurationMs: 1, maximumRssBytes: 1 },
	});
	worker.handleMessage({ contractVersion: 1, type: 'cancel', jobId: JOB_ID });
	await Promise.resolve();
	assert.equal(posted.some(({ type }) => type === 'cancelled'), false);
	releaseCancellation();
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(posted.at(-1).type, 'cancelled');
	worker.dispose();
});

test('the speech process exits without acknowledging when runner quiescence fails', async () => {
	const posted = [];
	const exits = [];
	const worker = createAssistanceHelperWorker({
		post: (message) => posted.push(message),
		runJob: () => ({
			completion: new Promise(() => {}),
			cancel: () => Promise.reject(new Error('worker thread would not terminate')),
		}),
		setIntervalImpl: () => ({ unref() {} }),
		clearIntervalImpl: () => {},
		exit: (code) => exits.push(code),
	});
	worker.handleMessage({
		contractVersion: 1,
		type: 'job',
		jobId: JOB_ID,
		kind: 'assistance-speech',
		jobContractVersion: 1,
		grant: { operation: 'status', moduleId: 'sherpa-onnx-node' },
		resourcePolicy: { maximumInputBytes: 1, maximumJobDurationMs: 1, maximumRssBytes: 1 },
	});
	worker.handleMessage({ contractVersion: 1, type: 'cancel', jobId: JOB_ID });
	await Promise.resolve();
	await Promise.resolve();
	assert.deepEqual(exits, [1]);
	assert.equal(posted.some(({ type }) => type === 'cancelled'), false);
});
