/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElectronEditingFailureReport } from '../scripts/performance/electron-editing-failure-report.ts';

test('an Electron failure receipt serializes every completed observation and host/profile metadata', () => {
	const results = Array.from({ length: 42 }, (_, trial) => ({
		name: `apply-${trial}`, trial, latencyMs: 12.25 + trial / 8, zero: 0,
		frames: [16.5, 33.125], completion: { painted: true, revision: 900 + trial },
	}));
	const context = {
		schemaVersion: 1, variant: 'before', preference: 'speed',
		host: { node: 'v26.5.0', cpuCount: 24, renderer: 'software' },
		profile: { path: '/tmp/profile-before-1', fresh: true },
	};
	const error = new RangeError('The actual playhead did not advance.');
	error.stack = 'RangeError: The actual playhead did not advance.\n    at observePlayback (harness:42:8)';
	const receipt = createElectronEditingFailureReport(context, results, error);
	assert.deepEqual(JSON.parse(JSON.stringify(receipt)), {
		...context, status: 'failed', completedObservationCount: 42, results,
		error: { name: error.name, message: error.message, stack: error.stack },
	});
	results.push({ name: 'later', trial: 42, latencyMs: 1, zero: 0, frames: [], completion: { painted: false, revision: 999 } });
	assert.equal(receipt.results.length, 42, 'later caller appends cannot change the failure snapshot');
	assert.equal(receipt.completedObservationCount, 42);
});

test('explicit failure fields override stale success status, count, rows and error', () => {
	const results = [{ latencyMs: .000_125, count: Number.MAX_SAFE_INTEGER }];
	const receipt = createElectronEditingFailureReport({
		status: 'succeeded', completedObservationCount: 800, results: [{ stale: true }],
		error: { name: 'Stale', message: 'not this failure' },
	}, results, new Error('Playback stopped.'));
	assert.equal(receipt.status, 'failed');
	assert.equal(receipt.completedObservationCount, 1);
	assert.deepEqual(receipt.results, results);
	assert.equal(receipt.error.name, 'Error');
	assert.equal(receipt.error.message, 'Playback stopped.');
	assert.doesNotMatch(JSON.stringify(receipt), /succeeded|stale|not this failure/u);
});

test('non-Error thrown refusals and absent stacks remain serializable without masking completed rows', () => {
	for (const refusal of ['engine deadline', null, undefined, 37, 2n, Symbol('refusal')]) {
		const report = createElectronEditingFailureReport({}, [{ ms: 4.125 }], refusal);
		assert.deepEqual(JSON.parse(JSON.stringify(report)), {
			status: 'failed', completedObservationCount: 1, results: [{ ms: 4.125 }],
			error: { name: 'NonErrorThrown', message: String(refusal) },
		});
	}
	const error = new Error('No stack available.');
	delete error.stack;
	assert.deepEqual(createElectronEditingFailureReport({}, [], error).error, {
		name: 'Error', message: 'No stack available.',
	});
	const unprintable = { toString(): never { throw new Error('toString refused'); } };
	assert.equal(createElectronEditingFailureReport({}, [], unprintable).error.message,
		'A non-Error value was thrown and could not be converted to text.');
});
