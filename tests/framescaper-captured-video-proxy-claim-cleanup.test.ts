/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	type CapturedVideoProxyClaimCleanup,
	type CapturedVideoProxyCleanupOperation,
	cleanupCapturedVideoProxyClaims,
} from '../src/framescaper/editor-captured-video-proxy-claim-cleanup.ts';

type Scope = Readonly<{
	readonly sessionProjects: readonly unknown[];
	readonly histories: readonly unknown[];
	readonly pendingSaveSnapshots: readonly unknown[];
}>;

const OPERATION: CapturedVideoProxyCleanupOperation = Object.freeze({
	operationId: 'cleanup-1',
	projectId: 'project-1',
	sourceId: 'video-source',
	baseFingerprint: 'fingerprint-1',
});

const SNAPSHOT = Object.freeze({
	tabs: Object.freeze([
		{ history: { present: { id: 'project-1' } } },
		{ history: { present: { id: 'project-2' } } },
	]),
});

function cleanup(
	implementation: () => { status: 'settled' | 'indeterminate' } | never,
	observed?: (scope: Scope) => void,
): CapturedVideoProxyClaimCleanup {
	return {
		cleanupOperation: async (_operation, scope) => {
			observed?.(scope as Scope);
			return implementation();
		},
	};
}

test('no cleanup port is consulted when there is no operation to settle', async () => {
	let consulted = false;
	const port = cleanup(() => {
		consulted = true;
		return { status: 'settled' };
	});

	assert.deepEqual(await cleanupCapturedVideoProxyClaims(port, null, SNAPSHOT), []);
	assert.equal(consulted, false);
});

test('a settled cleanup reports no retained failures', async () => {
	const port = cleanup(() => ({ status: 'settled' }));

	assert.deepEqual(await cleanupCapturedVideoProxyClaims(port, OPERATION, SNAPSHOT), []);
});

test('the cleanup scope carries each tab present project alongside its whole history', async () => {
	let scope: Scope | null = null;
	const port = cleanup(() => ({ status: 'settled' }), (value) => { scope = value; });

	await cleanupCapturedVideoProxyClaims(port, OPERATION, SNAPSHOT);

	assert.deepEqual(scope!.sessionProjects, [{ id: 'project-1' }, { id: 'project-2' }]);
	assert.deepEqual(scope!.histories, SNAPSHOT.tabs.map(({ history }) => history));
	assert.deepEqual(scope!.pendingSaveSnapshots, []);
});

test('an indeterminate cleanup is retained as a failure for startup retry', async () => {
	const port = cleanup(() => ({ status: 'indeterminate' }));

	const failures = await cleanupCapturedVideoProxyClaims(port, OPERATION, SNAPSHOT);

	assert.equal(failures.length, 1);
	assert.match(String((failures[0] as Error).message), /retained for startup retry/u);
});

test('a cleanup port that rejects surfaces its own error rather than throwing', async () => {
	const reason = new Error('the cleanup port is unavailable');
	const port: CapturedVideoProxyClaimCleanup = {
		cleanupOperation: async () => { throw reason; },
	};

	assert.deepEqual(await cleanupCapturedVideoProxyClaims(port, OPERATION, SNAPSHOT), [reason]);
});
