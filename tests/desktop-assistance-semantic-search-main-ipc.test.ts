/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS,
	registerAssistanceSemanticSearchMainIpc,
} from '../desktop/assistance-semantic-search-main-ipc.ts';
import { AssistanceSemanticSearchSessionAuthority } from
	'../desktop/assistance-semantic-search-session-authority.ts';

function fixture() {
	type Handler = (event: unknown, value?: unknown) => unknown;
	const handlers = new Map<string, Handler>();
	const removed: string[] = [];
	let byte = 0xaa;
	const authority = new AssistanceSemanticSearchSessionAuthority({
		now: () => 1_800_000_000_000,
		randomBytes: (size) => new Uint8Array(size).fill(byte++),
	});
	const registration = registerAssistanceSemanticSearchMainIpc({
		handle: (channel, handler) => handlers.set(channel, handler),
		removeHandler: (channel) => { removed.push(channel); handlers.delete(channel); },
		ownerFor: (event) => event && typeof event === 'object'
			? (event as { owner?: object }).owner ?? null : null,
		authority,
	});
	return { authority, handlers, registration, removed };
}

test('semantic-search IPC issues and reauthorizes only an owner-bound short session', () => {
	const { handlers } = fixture();
	const owner = {};
	const open = handlers.get(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS.open)!;
	const authorize = handlers.get(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS.authorize)!;
	const session = open({ owner }, { projectId: 'project-1', projectRevision: 7 });
	assert.deepEqual(session, {
		sessionVersion: 1, sessionId: 'aa'.repeat(20), projectId: 'project-1',
		projectRevision: 7, expiresAtEpochMs: 1_800_000_300_000,
	});
	assert.deepEqual(authorize({ owner }, {
		session, projectId: 'project-1', projectRevision: 7,
	}), session);
	assert.throws(() => authorize({ owner: {} }, {
		session, projectId: 'project-1', projectRevision: 7,
	}), /owner|session/iu);
	assert.throws(() => authorize({ owner }, {
		session, projectId: 'project-1', projectRevision: 8,
	}), /revision|stale|project/iu);
});

test('semantic-search IPC revokes one session or every session for a renderer owner', () => {
	const { handlers, registration } = fixture();
	const owner = {};
	const open = handlers.get(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS.open)!;
	const revoke = handlers.get(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS.revoke)!;
	const first = open({ owner }, { projectId: 'project-1', projectRevision: 7 }) as
		Readonly<{ sessionId: string }>;
	const second = open({ owner }, { projectId: 'project-1', projectRevision: 7 }) as
		Readonly<{ sessionId: string }>;
	assert.equal(revoke({ owner }, first.sessionId), true);
	assert.equal(revoke({ owner }, first.sessionId), false);
	assert.equal(registration.revokeOwner(owner), 1);
	assert.equal(registration.revokeOwner(owner), 0);
	assert.match(second.sessionId, /^[a-f\d]{40}$/u);
});

test('semantic-search IPC refuses malformed authority and removes every handler on disposal', () => {
	const { handlers, registration, removed } = fixture();
	const open = handlers.get(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS.open)!;
	assert.throws(() => open({}, { projectId: 'project-1', projectRevision: 7 }), /owner/iu);
	assert.throws(() => open({ owner: {} }, {
		projectId: '../escape', projectRevision: 7,
	}));
	registration.dispose();
	assert.deepEqual(removed.sort(), Object.values(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS).sort());
	assert.equal(handlers.size, 0);
});
