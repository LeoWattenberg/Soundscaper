/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	evaluateWithTransientBrowserRetry,
	isTransientIndexedDbEvaluationError,
} from './browser/helpers/transient-evaluation-retry.js';

test('transient IndexedDB evaluation errors are retried before returning the value', async () => {
	let attempts = 0;
	const page = {
		async evaluate(operation, argument) {
			attempts += 1;
			if (attempts < 3) {
				throw new Error('page.evaluate: The operation failed for reasons unrelated to the database itself.');
			}
			return operation(argument);
		},
	};

	const result = await evaluateWithTransientBrowserRetry(page, (value) => value * 2, 21, {
		delay: async () => undefined,
	});

	assert.equal(result, 42);
	assert.equal(attempts, 3);
});

test('non-transient evaluation failures are not retried', async () => {
	let attempts = 0;
	const failure = new Error('page.evaluate: project record is malformed');
	const page = {
		async evaluate() {
			attempts += 1;
			throw failure;
		},
	};

	await assert.rejects(
		evaluateWithTransientBrowserRetry(page, () => undefined, undefined),
		(error) => error === failure,
	);
	assert.equal(attempts, 1);
});

test('the transient classifier is limited to browser database availability errors', () => {
	assert.equal(isTransientIndexedDbEvaluationError(new Error('UnknownError: IndexedDB unavailable')), true);
	assert.equal(isTransientIndexedDbEvaluationError(new Error(
		'The operation failed for reasons unrelated to the database itself and not covered by any other error code.',
	)), true);
	assert.equal(isTransientIndexedDbEvaluationError(new Error('AbortError: transaction was aborted')), true);
	assert.equal(isTransientIndexedDbEvaluationError(new Error('DataError: invalid key')), false);
	assert.equal(isTransientIndexedDbEvaluationError('UnknownError'), false);
});
