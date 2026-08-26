/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const SESSION = Object.freeze({
	sessionVersion: 1, sessionId: 'a'.repeat(40), projectId: 'project-1',
	projectRevision: 7, expiresAtEpochMs: 1_800_000_060_000,
});

test('preload exposes a closed pathless semantic-search session bridge', async () => {
	const fixture = await loadPreload([SESSION, SESSION, (_channel, request) => ({
		queryVersion: 1, queryId: request.queryId, outcome: 'completed', provider: 'transcript',
		embedding: Array.from({ length: 768 }, (_entry, index) => index === 0 ? 1 : 0),
	}), true, true]);
	const search = fixture.bridge.localAssistance.semanticSearch;
	const opened = await search.open({ projectId: 'project-1', projectRevision: 7 });
	const authorized = await search.authorize({
		session: opened, projectId: 'project-1', projectRevision: 7,
	});
	assert.deepEqual(Object.keys(opened), [
		'sessionVersion', 'sessionId', 'projectId', 'projectRevision', 'expiresAtEpochMs',
	]);
	assert.deepEqual(authorized, opened);
	const queryId = 'b'.repeat(40);
	const result = await search.query({
		queryVersion: 1, queryId, session: opened, projectId: 'project-1', projectRevision: 7,
		provider: 'transcript', query: 'red bicycle',
	});
	assert.equal(result.embedding.length, 768);
	assert.equal(result.embedding[0], 1);
	assert.equal(await search.cancelQuery(queryId), true);
	assert.equal(await search.revoke(opened.sessionId), true);
	assert.deepEqual(JSON.parse(JSON.stringify(fixture.invocations)), [
		['soundscaper:v1:assistance:semantic-search:open', {
			projectId: 'project-1', projectRevision: 7,
		}],
		['soundscaper:v1:assistance:semantic-search:authorize', {
			session: SESSION, projectId: 'project-1', projectRevision: 7,
		}],
		['soundscaper:v1:assistance:semantic-search:query', {
			queryVersion: 1, queryId, session: SESSION, projectId: 'project-1',
			projectRevision: 7, provider: 'transcript', query: 'red bicycle',
		}],
		['soundscaper:v1:assistance:semantic-search:cancel-query', queryId],
		['soundscaper:v1:assistance:semantic-search:revoke', SESSION.sessionId],
	]);
});

test('preload rejects forged semantic-search authority on both IPC sides', async () => {
	const malformedResult = await loadPreload([{ ...SESSION, projectRevision: -1 }]);
	await assert.rejects(malformedResult.bridge.localAssistance.semanticSearch.open({
		projectId: 'project-1', projectRevision: 7,
	}), /semantic-search|revision|session|non-negative/iu);
	const malformedRequest = await loadPreload([]);
	await assert.rejects(malformedRequest.bridge.localAssistance.semanticSearch.open({
		projectId: '../escape', projectRevision: 7,
	}), /semantic-search|project/iu);
	await assert.rejects(malformedRequest.bridge.localAssistance.semanticSearch.revoke('../session'),
		/semantic-search|identifier/iu);
	assert.deepEqual(malformedRequest.invocations, []);
});

test('semantic-search preload activation does not grow the maintained script ratchet', async () => {
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	assert.ok(source.trimEnd().split('\n').length <= 756);
});

async function loadPreload(invocationResults) {
	let bridge;
	const invocations = [];
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	vm.runInNewContext(source, {
		AbortController, AggregateError, ArrayBuffer, Array, Number, Object, Promise,
		RangeError, String, TypeError, Uint8Array, URL,
		require: () => ({
			contextBridge: { exposeInMainWorld(name, value) {
				if (name === 'scapeDesktop') bridge = value.v1;
			} },
			ipcRenderer: {
				invoke(channel, value) {
					invocations.push([channel, value]);
					const result = invocationResults.shift();
					if (typeof result === 'function') return Promise.resolve(result(channel, value));
					return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
				},
				send: () => {}, on: () => {}, removeListener: () => {},
			},
		}),
	});
	return { bridge, invocations };
}
