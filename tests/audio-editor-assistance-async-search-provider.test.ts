/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAssistanceAsyncSearchCoordinator,
	validateAssistanceSemanticSearchSession,
} from '../src/common/editor/assistance/async-search-provider.ts';

const NOW = 1_800_000_000_000;
const SESSION = Object.freeze({
	sessionVersion: 1,
	sessionId: 'a'.repeat(40),
	schemaFamily: 'soundscaper' as const,
	schemaVersion: 1 as const,
	projectId: 'project-1',
	projectRevision: 12,
	expiresAtEpochMs: NOW + 60_000,
});

test('an expiring semantic-search session is closed, project-bound, and short lived', () => {
	assert.deepEqual(validateAssistanceSemanticSearchSession(SESSION, NOW), SESSION);
	for (const value of [
		{ ...SESSION, sessionId: '../session' },
		{ ...SESSION, projectRevision: -1 },
		{ ...SESSION, expiresAtEpochMs: NOW },
		{ ...SESSION, expiresAtEpochMs: NOW + 60 * 60 * 1_000 + 1 },
		{ ...SESSION, extra: true },
	] as const) assert.throws(() => validateAssistanceSemanticSearchSession(value, NOW));
});

test('the async coordinator cancels old work and suppresses a provider that settles stale', async () => {
	type Pending = Readonly<{
		query: string;
		signal: AbortSignal;
		resolve(value: unknown): void;
	}>;
	const pending: Pending[] = [];
	const coordinator = createAssistanceAsyncSearchCoordinator({
		session: SESSION,
		now: () => NOW,
		provider: {
			search: ({ query, signal }) => new Promise((resolve) => {
				pending.push({ query, signal, resolve });
			}),
		},
	});
	const first = coordinator.search('first');
	const second = coordinator.search('second');
	assert.equal(pending[0]?.signal.aborted, true);
	assert.equal(pending[1]?.signal.aborted, false);
	pending[0]?.resolve([{ resultId: 'old', timelineFrame: 1, label: 'Old', detail: null,
		providers: ['transcript'] }]);
	pending[1]?.resolve([{ resultId: 'new', timelineFrame: 2, label: 'New', detail: 'OCR',
		providers: ['visual', 'ocr'] }]);
	assert.deepEqual(await first, { disposition: 'stale', revision: 1, entries: [] });
	assert.deepEqual(await second, { disposition: 'accepted', revision: 2, entries: [{
		kind: 'assistance', key: 'assistance:new', label: 'New', detail: 'OCR',
		disabled: false, disabledReason: null, state: 'enabled', reason: null,
		handler: null, sourceOrder: 0,
		target: { resultId: 'new', timelineFrame: 2 }, providers: ['visual', 'ocr'],
	}] });
	const third = coordinator.search('third');
	coordinator.dispose();
	assert.equal(pending[2]?.signal.aborted, true);
	pending[2]?.resolve([]);
	assert.deepEqual(await third, { disposition: 'stale', revision: 3, entries: [] });
});

test('async Assistance search refuses malformed results and expires without querying', async () => {
	let calls = 0;
	const provider = { search: async () => {
		calls += 1;
		return [{ resultId: 'bad', timelineFrame: Number.NaN, label: 'Bad', detail: null,
			providers: ['ocr'] }];
	} };
	const active = createAssistanceAsyncSearchCoordinator({ session: SESSION,
		now: () => NOW, provider });
	await assert.rejects(active.search('bad'), /timeline frame/iu);
	let currentTime = NOW;
	const expired = createAssistanceAsyncSearchCoordinator({ session: SESSION,
		now: () => currentTime, provider });
	currentTime = NOW + 60_001;
	await assert.rejects(expired.search('late'), /expired/iu);
	assert.equal(calls, 1);
});
