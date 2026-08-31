/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { Aup4WorkerRequestState } from '../src/common/editor/aup4-worker-request-state.ts';

test('AUP4 worker cancellation is retained only for an active request', () => {
	const state = new Aup4WorkerRequestState();

	state.cancel('late-request');
	state.begin('late-request');
	assert.equal(state.isCancelled('late-request'), false);

	state.begin('active-request');
	state.cancel('active-request');
	assert.equal(state.isCancelled('active-request'), true);
	state.finish('active-request');
	assert.equal(state.isCancelled('active-request'), false);
});
