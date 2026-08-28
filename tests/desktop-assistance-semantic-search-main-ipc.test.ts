/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS,
	registerAssistanceSemanticSearchMainIpc,
} from '../desktop/assistance-semantic-search-main-ipc.ts';
import { AssistanceSemanticSearchSessionAuthority } from
	'../desktop/assistance-semantic-search-session-authority.ts';
import { IPC } from '../desktop/constants.js';
import type { AssistanceSemanticQueryExecutorV1 } from
	'../desktop/assistance-semantic-query-executor.ts';

const QUERY_ID = '1'.repeat(40);
const PROJECT_AUTHORITY = Object.freeze({
	schemaFamily: 'soundscaper' as const,
	schemaVersion: 1 as const,
	projectId: 'project-1',
	projectRevision: 7,
});

function fixture(query: AssistanceSemanticQueryExecutorV1 = Object.freeze({ embed: async ({ provider }: Readonly<{
	provider: 'transcript' | 'visual';
}>) => Object.freeze({
	queryResultVersion: 1 as const, outcome: 'completed' as const, provider,
	embedding: Object.freeze(Array.from({ length: 768 }, (_value, index) => index === 0 ? 1 : 0)),
}) })) {
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
		query,
	});
	return { authority, handlers, registration, removed };
}

test('semantic-search IPC issues and reauthorizes only an owner-bound short session', () => {
	const { handlers } = fixture();
	const owner = {};
	const open = handlers.get(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS.open)!;
	const authorize = handlers.get(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS.authorize)!;
	const session = open({ owner }, PROJECT_AUTHORITY);
	assert.deepEqual(session, {
		sessionVersion: 1, sessionId: 'aa'.repeat(20), ...PROJECT_AUTHORITY,
		expiresAtEpochMs: 1_800_000_300_000,
	});
	assert.deepEqual(authorize({ owner }, { session, ...PROJECT_AUTHORITY }), session);
	assert.throws(() => authorize({ owner: {} }, {
		session, ...PROJECT_AUTHORITY,
	}), /owner|session/iu);
	assert.throws(() => authorize({ owner }, {
		session, schemaFamily: 'soundscaper', schemaVersion: 1,
		projectId: 'project-1', projectRevision: 8,
	}), /revision|stale|project/iu);
});

test('semantic-search IPC revokes one session or every session for a renderer owner', async () => {
	const { handlers, registration } = fixture();
	const owner = {};
	const open = handlers.get(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS.open)!;
	const revoke = handlers.get(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS.revoke)!;
	const first = open({ owner }, PROJECT_AUTHORITY) as
		Readonly<{ sessionId: string }>;
	const second = open({ owner }, PROJECT_AUTHORITY) as
		Readonly<{ sessionId: string }>;
	assert.equal(await revoke({ owner }, first.sessionId), true);
	assert.equal(await revoke({ owner }, first.sessionId), false);
	assert.equal(await registration.revokeOwner(owner), 1);
	assert.equal(await registration.revokeOwner(owner), 0);
	assert.match(second.sessionId, /^[a-f\d]{40}$/u);
});

test('semantic-search IPC refuses malformed authority and removes every handler on disposal', async () => {
	const { handlers, registration, removed } = fixture();
	const open = handlers.get(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS.open)!;
	assert.throws(() => open({}, PROJECT_AUTHORITY), /owner/iu);
	assert.throws(() => open({ owner: {} }, {
		schemaFamily: 'soundscaper', schemaVersion: 1,
		projectId: '../escape', projectRevision: 7,
	}));
	await registration.dispose();
	assert.deepEqual(removed.sort(), Object.values(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS).sort());
	assert.equal(handlers.size, 0);
});

test('semantic-search IPC executes only an owner/session-bound pathless query', async () => {
	const seen: unknown[] = [];
	const { handlers } = fixture(Object.freeze({ embed: async (request: unknown) => {
		seen.push(request);
		return Object.freeze({ queryResultVersion: 1 as const, outcome: 'completed' as const,
			provider: 'transcript' as const,
			embedding: Object.freeze(Array.from({ length: 768 }, (_value, index) =>
				index === 0 ? 1 : 0)) });
	} }));
	const owner = {};
	const session = handlers.get(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS.open)!(
		{ owner }, PROJECT_AUTHORITY,
	);
	const result = await handlers.get(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS.query)!(
		{ owner }, { queryVersion: 1, queryId: QUERY_ID, session,
			...PROJECT_AUTHORITY,
			provider: 'transcript', query: 'red bicycle' },
	);
	assert.deepEqual(result, {
		queryVersion: 1, queryId: QUERY_ID, outcome: 'completed', provider: 'transcript',
		embedding: Array.from({ length: 768 }, (_value, index) => index === 0 ? 1 : 0),
	});
	assert.equal(seen.length, 1);
	assert.deepEqual(Object.keys(seen[0] as object).sort(), ['provider', 'query', 'signal']);
	assert.equal((seen[0] as { signal: AbortSignal }).signal.aborted, false);
	await assert.rejects(Promise.resolve(handlers.get(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS.query)!(
		{ owner: {} }, { queryVersion: 1, queryId: '2'.repeat(40), session,
			...PROJECT_AUTHORITY,
			provider: 'transcript', query: 'red bicycle' },
	)), /owner|session/iu);
});

test('query cancellation aborts installed inference and waits for its completion barrier', async () => {
	let entered!: () => void;
	const running = new Promise<void>((resolve) => { entered = resolve; });
	const { handlers, registration } = fixture(Object.freeze({ embed: async (
		{ signal }: Readonly<{ signal: AbortSignal }>,
	) => {
		entered();
		await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => {
			reject(signal.reason);
		}, { once: true }));
		throw new Error('unreachable');
	} }));
	const owner = {};
	const session = handlers.get(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS.open)!(
		{ owner }, PROJECT_AUTHORITY,
	);
	const pending = Promise.resolve(handlers.get(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS.query)!(
		{ owner }, { queryVersion: 1, queryId: QUERY_ID, session,
			...PROJECT_AUTHORITY,
			provider: 'visual', query: 'cancel me' },
	));
	await running;
	assert.equal(await handlers.get(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS.cancelQuery)!(
		{ owner }, QUERY_ID,
	), true);
	await assert.rejects(pending, { name: 'AbortError' });
	assert.equal(await handlers.get(ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS.cancelQuery)!(
		{ owner }, QUERY_ID,
	), false);
	await registration.dispose();
});

test('the main channel table restates the shared IPC map exactly', () => {
	// This module is staged into the project-library runtime, whose expected file set does
	// not include constants.js, so it names the channels itself rather than importing them -
	// exactly as the sandboxed preload does. Three copies of a string drift silently, and a
	// channel main registers under a name the bridge never invokes is unreachable.
	assert.deepEqual({ ...ASSISTANCE_SEMANTIC_SEARCH_IPC_CHANNELS }, {
		open: IPC.assistanceSemanticSearchOpen,
		authorize: IPC.assistanceSemanticSearchAuthorize,
		revoke: IPC.assistanceSemanticSearchRevoke,
		query: IPC.assistanceSemanticSearchQuery,
		cancelQuery: IPC.assistanceSemanticSearchCancelQuery,
	});
});
