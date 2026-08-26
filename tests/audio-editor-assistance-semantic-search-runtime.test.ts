/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAssistanceEmbeddingMatrixV1 } from
	'../src/common/editor/assistance/binary-formats-v1.ts';
import {
	AssistanceSemanticSearchUnavailableError,
	createAssistanceSemanticSearchMenuSourceV1,
} from '../src/common/editor/assistance/semantic-search-runtime-v1.ts';

const NOW = 1_800_000_000_000;
const AUTHORITY = Object.freeze({ projectId: 'project-1', projectRevision: 7 });
const SESSION = Object.freeze({
	sessionVersion: 1 as const, sessionId: 'a'.repeat(40), ...AUTHORITY,
	expiresAtEpochMs: NOW + 60_000,
});

function index() {
	return {
		indexVersion: 1 as const, ...AUTHORITY,
		transcript: {
			matrix: createAssistanceEmbeddingMatrixV1({ dimensions: 2, vectors: [[1, 0]] }),
			rows: [{ resultId: 'shared', timelineFrame: 100, label: 'spoken launch plan' }],
		},
		visual: {
			matrix: createAssistanceEmbeddingMatrixV1({ dimensions: 2, vectors: [[1, 0]] }),
			rows: [{ resultId: 'shared', timelineFrame: 100, label: 'launch slide' }],
		},
		ocr: [{ resultId: 'shared', timelineFrame: 100, label: 'Launch Plan' }],
	};
}

function custody(indexValue: unknown = index()) {
	return Object.freeze({
		custodyVersion: 1 as const,
		disposition: 'authenticated-disposable' as const,
		...AUTHORITY,
		records: Object.freeze([
			{ kind: 'embeddings' as const, identitySha256: 'b'.repeat(64),
				payloadSha256: 'c'.repeat(64) },
			{ kind: 'visual-index' as const, identitySha256: 'd'.repeat(64),
				payloadSha256: 'e'.repeat(64) },
		]),
		index: indexValue,
	});
}

test('menu opening binds authenticated disposable custody to one main-authorized session', async () => {
	const calls: string[] = [];
	const source = createAssistanceSemanticSearchMenuSourceV1({
		now: () => NOW,
		sessions: {
			open: async (authority) => { calls.push(`open:${authority.projectRevision}`); return SESSION; },
			authorize: async ({ session }) => { calls.push(`authorize:${session.sessionId}`); return SESSION; },
			revoke: async (sessionId) => { calls.push(`revoke:${sessionId}`); return true; },
			embedInstalledQuery: async ({ provider, query, signal, session }) => {
				calls.push(`embed:${provider}:${query}`);
				assert.equal(signal.aborted, false);
				assert.deepEqual(session, SESSION);
				return new Float32Array([1, 0]);
			},
		},
		custody: { loadAuthenticated: async (authority, signal) => {
			calls.push(`custody:${authority.projectId}`);
			assert.equal(signal.aborted, false);
			return custody();
		} },
	});
	assert.equal(calls.length, 0, 'construction cannot touch custody, models, or native prompts');
	const opened = await source.open(AUTHORITY);
	assert.deepEqual(calls, ['custody:project-1', 'open:7']);
	const result = await opened.coordinator.search('launch plan');
	assert.equal(result.disposition, 'accepted');
	assert.deepEqual(result.entries[0], {
		kind: 'assistance', key: 'assistance:shared', label: 'spoken launch plan',
		detail: 'Visual: launch slide · OCR: Launch Plan', disabled: false,
		disabledReason: null, state: 'enabled', reason: null, handler: null,
		sourceOrder: 0, target: { resultId: 'shared', timelineFrame: 100 },
		providers: ['transcript', 'visual', 'ocr'],
	});
	assert.deepEqual(calls.slice(2), [
		`authorize:${SESSION.sessionId}`,
		'embed:transcript:launch plan',
		'embed:visual:launch plan',
	]);
	await opened.dispose();
	await opened.dispose();
	assert.equal(calls.filter((value) => value.startsWith('revoke:')).length, 1);
});

test('missing or forged disposable custody is typed unavailable before sessions or inference', async () => {
	let sessions = 0;
	let embeddings = 0;
	const create = (value: unknown) => createAssistanceSemanticSearchMenuSourceV1({
		now: () => NOW,
		sessions: {
			open: async () => { sessions += 1; return SESSION; },
			authorize: async () => SESSION,
			revoke: async () => true,
			embedInstalledQuery: async () => { embeddings += 1; return [1, 0]; },
		},
		custody: { loadAuthenticated: async () => value },
	});
	await assert.rejects(create(null).open(AUTHORITY), (error) => (
		error instanceof AssistanceSemanticSearchUnavailableError
		&& error.reason === 'index-unavailable'
	));
	await assert.rejects(create({ ...custody(), records: [custody().records[0]] }).open(AUTHORITY),
		/authenticated|visual-index|custody/iu);
	await assert.rejects(create({ ...custody(), projectRevision: 8 }).open(AUTHORITY),
		/project|revision|authority/iu);
	await assert.rejects(create(custody({ ...index(), projectRevision: 8 })).open(AUTHORITY),
		/project|revision|authority/iu);
	assert.equal(sessions, 0);
	assert.equal(embeddings, 0);
});

test('a superseded query aborts installed embedding work and cannot publish stale hits', async () => {
	type Pending = Readonly<{ signal: AbortSignal; resolve(value: ArrayLike<number>): void }>;
	const pending: Pending[] = [];
	const source = createAssistanceSemanticSearchMenuSourceV1({
		now: () => NOW,
		sessions: { open: async () => SESSION, authorize: async () => SESSION,
			revoke: async () => true,
			embedInstalledQuery: ({ signal }) => new Promise((resolve) =>
				pending.push({ signal, resolve })),
		},
		custody: { loadAuthenticated: async () => custody() },
	});
	const opened = await source.open(AUTHORITY);
	const first = opened.coordinator.search('first');
	await new Promise((resolve) => setTimeout(resolve, 0));
	const second = opened.coordinator.search('second');
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(pending[0]?.signal.aborted, true);
	for (const item of pending) item.resolve([1, 0]);
	assert.equal((await first).disposition, 'stale');
	assert.equal((await second).disposition, 'accepted');
	await opened.dispose();
});
