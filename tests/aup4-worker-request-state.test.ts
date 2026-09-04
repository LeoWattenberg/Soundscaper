/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

test('AUP4 deserialize failure leaves FREEONCLOSE buffer ownership with SQLite', async () => {
	const source = await readFile(new URL('../src/common/editor/aup4-worker.js', import.meta.url), 'utf8');
	const deserialize = source.slice(
		source.indexOf('function deserializeMemoryDatabase'),
		source.indexOf('function configureDefensiveDatabase'),
	);

	assert.match(deserialize, /SQLITE_DESERIALIZE_FREEONCLOSE/u);
	assert.doesNotMatch(deserialize, /dealloc/u);
});

test('AUP4 snapshot compatibility state is published only after COMMIT succeeds', async () => {
	const source = await readFile(
		new URL('../src/common/editor/aup4-worker-snapshot.js', import.meta.url), 'utf8',
	);
	const finalize = source.slice(
		source.indexOf('function finalizeSnapshot'),
		source.indexOf('function abortSnapshot'),
	);
	const commit = finalize.indexOf("database.exec('COMMIT')");
	const publication = finalize.indexOf('entry.lastExportCompatibilityReport =');
	assert.ok(commit >= 0 && publication > commit,
		'the compatibility report must not describe a transaction that rolled back');
});
