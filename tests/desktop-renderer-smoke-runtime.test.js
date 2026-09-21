/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	runDesktopRendererSmokeOperation,
	runDesktopRendererSmokeOperationEnvelope,
} from '../desktop/renderer-smoke-runtime.js';

test('renderer smoke dispatch admits only exact, inventoried operations and arguments', () => {
	const calls = [];
	const operations = Object.freeze({ selected: (scope, ...args) => {
		calls.push([scope, args]);
		return args.length;
	} });
	const scope = {};
	assert.equal(runDesktopRendererSmokeOperation(scope, {
		operation: 'selected', arguments: ['one', 2],
	}, operations), 2);
	assert.deepEqual(calls, [[scope, ['one', 2]]]);
	for (const request of [null, [], {}, { operation: 'selected' },
		{ operation: 'selected', arguments: [], extra: true },
		{ operation: 'selected', arguments: null }]) {
		assert.throws(() => runDesktopRendererSmokeOperation(scope, request, operations),
			/Desktop renderer smoke request is invalid/u);
	}
	for (const operation of ['missing', 'toString', 'constructor']) {
		assert.throws(() => runDesktopRendererSmokeOperation(scope, {
			operation, arguments: [],
		}, operations), /Desktop renderer smoke operation is unsupported/u);
	}
});

test('renderer smoke envelopes normalize synchronous, asynchronous, and thrown-value failures', async () => {
	const scope = {};
	const operations = Object.freeze({
		fulfilled: () => Promise.resolve(9),
		rejected: () => Promise.reject({ message: 'rejected' }),
		thrown: () => { throw 'thrown'; },
	});
	const run = (operation) => runDesktopRendererSmokeOperationEnvelope(scope, {
		operation, arguments: [],
	}, operations);
	assert.deepEqual(await run('fulfilled'), { status: 'fulfilled', value: 9 });
	assert.deepEqual(await run('rejected'), { status: 'rejected', message: 'rejected' });
	assert.deepEqual(await run('thrown'), { status: 'rejected', message: 'thrown' });
	assert.deepEqual(await run('absent'), {
		status: 'rejected', message: 'Desktop renderer smoke operation is unsupported.',
	});
	assert.deepEqual(await runDesktopRendererSmokeOperationEnvelope(scope, null, operations), {
		status: 'rejected', message: 'Desktop renderer smoke request is invalid.',
	});
	const tooLong = 'x'.repeat(2_100);
	assert.equal((await runDesktopRendererSmokeOperationEnvelope(scope, {
		operation: 'long', arguments: [],
	}, { long: () => { throw new Error(tooLong); } })).message, tooLong.slice(0, 2_048));
});
