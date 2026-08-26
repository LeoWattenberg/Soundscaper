/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveLocalAssistanceBridge } from
	'../src/common/editor/ui/local-assistance-bridge.ts';

const NOW = Date.now();
const SESSION = Object.freeze({
	sessionVersion: 1 as const, sessionId: 'a'.repeat(40), projectId: 'project-1',
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
	}));
	assert.ok(bridge?.semanticSearch);
	const opened = await bridge.semanticSearch.open({ projectId: 'project-1', projectRevision: 7 });
	assert.deepEqual(opened, SESSION);
	assert.deepEqual(await bridge.semanticSearch.authorize({
		session: opened, projectId: 'project-1', projectRevision: 7,
	}), SESSION);
	assert.equal(await bridge.semanticSearch.revoke(opened.sessionId), true);
	assert.equal(calls.length, 3);
});

test('renderer refuses malformed semantic-search bridge shape and returned authority', async () => {
	assert.equal(resolveLocalAssistanceBridge(raw({ open: async () => SESSION })), null);
	const bridge = resolveLocalAssistanceBridge(raw({
		open: async () => ({ ...SESSION, extra: true }),
		authorize: async () => SESSION,
		revoke: async () => true,
	}));
	assert.ok(bridge?.semanticSearch);
	await assert.rejects(bridge.semanticSearch.open({
		projectId: 'project-1', projectRevision: 7,
	}), /fields|session/iu);
	await assert.rejects(bridge.semanticSearch.open({
		projectId: '../escape', projectRevision: 7,
	}), /project|authority/iu);
});
