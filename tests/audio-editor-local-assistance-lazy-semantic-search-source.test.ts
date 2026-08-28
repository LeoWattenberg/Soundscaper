/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createLocalAssistanceLazySemanticSearchSourceV1 } from
	'../src/common/editor/ui/local-assistance-lazy-semantic-search-source.ts';

const AUTHORITY = Object.freeze({
	schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
	projectId: 'project-1', projectRevision: 7,
});

test('menu-only source defers bridge and disposable-custody access until open', async () => {
	let listed = 0;
	let nativeCalls = 0;
	const source = createLocalAssistanceLazySemanticSearchSourceV1({
		bridgeScope: bridge(() => { nativeCalls += 1; }),
		repository: { listProject: async () => { listed += 1; return []; } },
	});
	assert.equal(listed, 0);
	assert.equal(nativeCalls, 0);
	await assert.rejects(source.open(AUTHORITY), (error) => Boolean(
		error && typeof error === 'object'
		&& (error as { reason?: unknown }).reason === 'index-unavailable',
	));
	assert.equal(listed, 1);
	assert.equal(nativeCalls, 0, 'missing custody cannot open a native session or model prompt');
});

test('source reports a typed desktop boundary without touching disposable storage', async () => {
	let listed = 0;
	const source = createLocalAssistanceLazySemanticSearchSourceV1({
		bridgeScope: Object.freeze({}),
		repository: { listProject: async () => { listed += 1; return []; } },
	});
	await assert.rejects(source.open(AUTHORITY), (error) => Boolean(
		error && typeof error === 'object'
		&& (error as { reason?: unknown }).reason === 'desktop-unavailable',
	));
	assert.equal(listed, 0);
});

function bridge(onNativeCall: () => void): Readonly<Record<string, unknown>> {
	const semanticSearch = Object.freeze({
		open: async () => { onNativeCall(); return null; },
		authorize: async () => { onNativeCall(); return null; },
		revoke: async () => { onNativeCall(); return false; },
		query: async () => { onNativeCall(); return null; },
		cancelQuery: async () => { onNativeCall(); return false; },
	});
	return Object.freeze({ localAssistance: Object.freeze({
		models: async () => [], createJob: async () => null, stageInput: async () => null,
		reserveOutput: async () => null, run: async () => null, cancel: async () => null,
		readOutput: async () => new Blob(), release: async () => true,
		onProgress: () => () => undefined, semanticSearch,
	}) });
}
