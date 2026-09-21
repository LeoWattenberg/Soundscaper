/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { exitAfterCoverageCheckpoint } from '../desktop/coverage-checkpoint-exit.mjs';

test('coverage is checkpointed before the requested Electron exit', () => {
	const calls = [];
	exitAfterCoverageCheckpoint({
		checkpoint: () => calls.push('coverage'),
		exit: (code) => calls.push(`exit:${code}`),
		reportError: () => assert.fail('a successful checkpoint must not be reported'),
	}, 0);
	assert.deepEqual(calls, ['coverage', 'exit:0']);
});

test('checkpoint and reporter failures still force a nonzero Electron exit', () => {
	const checkpointError = new Error('coverage write failed');
	const calls = [];
	exitAfterCoverageCheckpoint({
		checkpoint: () => { calls.push('coverage'); throw checkpointError; },
		reportError: (error) => { calls.push(error); throw new Error('reporter failed'); },
		exit: (code) => calls.push(`exit:${code}`),
	}, 0);
	assert.deepEqual(calls, ['coverage', checkpointError, 'exit:1']);
});
