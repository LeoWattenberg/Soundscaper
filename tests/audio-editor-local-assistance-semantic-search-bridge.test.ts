/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveLocalAssistanceBridge } from
	'../src/common/editor/assistance/local-assistance-bridge.ts';

const NOW = Date.now();
const PROJECT_IDENTITY = Object.freeze({ schemaFamily: 'framescaper' as const, schemaVersion: 1 as const });
const SESSION = Object.freeze({
	sessionVersion: 1 as const, sessionId: 'a'.repeat(40), ...PROJECT_IDENTITY,
	projectId: 'project-1',
	projectRevision: 7, expiresAtEpochMs: NOW + 60_000,
});

function raw(semanticSearch: unknown) {
	return { localAssistance: {
		models: async () => [], createJob: async () => ({ contractVersion: 1, jobId: 'b'.repeat(40) }),
		stageInput: async () => null, reserveOutput: async () => null, run: async () => null,
		cancel: async () => null, readOutput: async () => new Blob(), release: async () => true,
		onProgress: () => () => undefined,
		semanticSearch,
	} };
}

test('renderer projects the optional semantic-search session API without weakening legacy methods', async () => {
	const calls: unknown[] = [];
	const bridge = resolveLocalAssistanceBridge(raw({
		open: async (value: unknown) => { calls.push(value); return SESSION; },
		authorize: async (value: unknown) => { calls.push(value); return SESSION; },
		revoke: async (value: unknown) => { calls.push(value); return true; },
		query: async (value: unknown) => {
			calls.push(value);
			const queryId = (value as { queryId: string }).queryId;
			return { queryVersion: 1, queryId, outcome: 'completed', provider: 'transcript',
				embedding: Array.from({ length: 768 }, (_entry, index) => index === 0 ? 1 : 0) };
		},
		cancelQuery: async (value: unknown) => { calls.push(value); return false; },
	}));
	assert.ok(bridge?.semanticSearch);
	const opened = await bridge.semanticSearch.open({ ...PROJECT_IDENTITY,
		projectId: 'project-1', projectRevision: 7 });
	assert.deepEqual(opened, SESSION);
	assert.deepEqual(await bridge.semanticSearch.authorize({
		session: opened, ...PROJECT_IDENTITY, projectId: 'project-1', projectRevision: 7,
	}), SESSION);
	const embedding = await bridge.semanticSearch.embedInstalledQuery({
		session: opened, ...PROJECT_IDENTITY, projectId: 'project-1', projectRevision: 7,
		provider: 'transcript', query: 'red bicycle', signal: new AbortController().signal,
	});
	assert.equal(embedding.length, 768);
	assert.equal(embedding[0], 1);
	assert.equal(await bridge.semanticSearch.revoke(opened.sessionId), true);
	assert.equal(calls.length, 4);
	assert.match((calls[2] as { queryId: string }).queryId, /^[a-f\d]{40}$/u);
	assert.deepEqual(Object.keys(calls[2] as object).sort(), [
		'projectId', 'projectRevision', 'provider', 'query', 'queryId', 'queryVersion',
		'schemaFamily', 'schemaVersion', 'session',
	]);
});

test('renderer refuses malformed semantic-search bridge shape and returned authority', async () => {
	assert.equal(resolveLocalAssistanceBridge(raw({ open: async () => SESSION })), null);
	const bridge = resolveLocalAssistanceBridge(raw({
		open: async () => ({ ...SESSION, extra: true }),
		authorize: async () => SESSION,
		revoke: async () => true,
		query: async () => null,
		cancelQuery: async () => false,
	}));
	assert.ok(bridge?.semanticSearch);
	await assert.rejects(bridge.semanticSearch.open({
		...PROJECT_IDENTITY, projectId: 'project-1', projectRevision: 7,
	}), /fields|session/iu);
	await assert.rejects(bridge.semanticSearch.open({
		...PROJECT_IDENTITY, projectId: '../escape', projectRevision: 7,
	}), /project|authority/iu);
});

test('renderer cancels stale native query work and types unavailable installed models', async () => {
	let cancelId: string | null = null;
	const missing = resolveLocalAssistanceBridge(raw({
		open: async () => SESSION, authorize: async () => SESSION, revoke: async () => true,
		query: async (value: unknown) => ({ queryVersion: 1,
			queryId: (value as { queryId: string }).queryId,
			outcome: 'unavailable', reason: 'model-unavailable' }),
		cancelQuery: async () => false,
	}));
	assert.ok(missing?.semanticSearch);
	await assert.rejects(missing.semanticSearch.embedInstalledQuery({
		session: SESSION, ...PROJECT_IDENTITY, projectId: 'project-1', projectRevision: 7,
		provider: 'visual', query: 'query', signal: new AbortController().signal,
	}), (error) => Boolean(error && typeof error === 'object'
		&& (error as { reason?: unknown }).reason === 'query-models-unavailable'));

	let rejectQuery!: (reason: unknown) => void;
	let queryEntered!: () => void;
	const entered = new Promise<void>((resolve) => { queryEntered = resolve; });
	const cancellable = resolveLocalAssistanceBridge(raw({
		open: async () => SESSION, authorize: async () => SESSION, revoke: async () => true,
		query: () => new Promise((_resolve, reject) => {
			rejectQuery = reject;
			queryEntered();
		}),
		cancelQuery: async (value: unknown) => {
			cancelId = value as string;
			rejectQuery(new DOMException('cancelled', 'AbortError'));
			return true;
		},
	}));
	assert.ok(cancellable?.semanticSearch);
	const controller = new AbortController();
	const pending = cancellable.semanticSearch.embedInstalledQuery({
		session: SESSION, ...PROJECT_IDENTITY, projectId: 'project-1', projectRevision: 7,
		provider: 'transcript', query: 'cancel', signal: controller.signal,
	});
	await entered;
	controller.abort(new DOMException('stale', 'AbortError'));
	await assert.rejects(pending, { name: 'AbortError' });
	assert.match(cancelId ?? '', /^[a-f\d]{40}$/u);
});
