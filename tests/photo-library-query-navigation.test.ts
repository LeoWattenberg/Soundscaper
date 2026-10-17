/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PHOTO_LIBRARY_QUERY_V1, DEFAULT_PHOTO_LIBRARY_QUERY_V2, isMetadataQuery,
	readNonemptyQueryPage, readQueryStep, readVisiblePage, yieldTask,
	type PhotoLibraryQueryNavigationPort } from '../src/common/editor/controller/shared/photo-library-query-navigation.ts';
import type { PhotoLibraryPageV1, PhotoLibraryQueryStepV1, PhotoLibraryQueryV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import type { PhotoLibraryQueryV2 } from '../src/common/editor/photo-library-query-port-v2.ts';
import type { PhotoLibrarySavedCollectionPortV1, PhotoLibrarySavedCollectionQueryStepV1 } from '../src/common/editor/photo-library-saved-collection-port-v1.ts';

const row = Object.freeze({ id: 'photo', fileName: 'Photo.jpg', width: 32, height: 24,
	rating: 0, flag: 'unflagged' as const, colorLabel: 'none' as const });
function page(rows: readonly typeof row[] = [row], cursor: string | null = null): PhotoLibraryPageV1 {
	return { catalogName: 'Library', totalCount: 100, rows, cursor };
}
function step(rows: readonly typeof row[] = [row], cursor: string | null = null): PhotoLibraryQueryStepV1 {
	return { ...page(rows, cursor), scanned: 64 };
}
function port(overrides: Partial<PhotoLibraryQueryNavigationPort> = {}): PhotoLibraryQueryNavigationPort {
	const unexpected = async (): Promise<never> => { throw new Error('Unexpected query navigation port'); };
	return { readPage: unexpected, readQueryStep: unexpected, readStackQueryStep: unexpected,
		readQueryStepV2: unexpected, readStackQueryStepV2: unexpected, ...overrides };
}
async function rejectsExact(work: Promise<unknown>, reason: unknown): Promise<void> {
	let rejected = false;
	try { await work; } catch (failure) { rejected = true; assert.equal(failure, reason); }
	assert.equal(rejected, true);
}
function savedStep(rows: readonly typeof row[] = [row], cursor: string | null = null,
	mode: 'ordinary' | 'collapsed' = 'ordinary'): PhotoLibrarySavedCollectionQueryStepV1 {
	return { ...step(rows, cursor), collectionId: 'saved', collectionName: 'Saved', mode,
		context: { catalogId: 'catalog', catalogRevision: 2, indexRevision: 3, collectionStateRevision: 4 },
		definitionRevision: 1, definitionSha256: 'a'.repeat(64), querySha256: 'b'.repeat(64), stackStateRevision: mode === 'ordinary' ? null : 2 };
}
function savedPort(readQueryStep: PhotoLibrarySavedCollectionPortV1['readQueryStep']): PhotoLibrarySavedCollectionPortV1 {
	const unexpected = async (): Promise<never> => { throw new Error('Navigation cannot load or author recipes'); };
	return { readPage: unexpected, readSnapshot: unexpected, apply: unexpected, readQueryStep };
}

test('the same deeply frozen defaults retain V1/V2 profile and sort semantics', () => {
	assert.deepEqual(DEFAULT_PHOTO_LIBRARY_QUERY_V1, { text: '', filter: null, sort: { field: 'photo-id', direction: 'ascending' } });
	assert.deepEqual(DEFAULT_PHOTO_LIBRARY_QUERY_V2, { schemaVersion: 2, kind: 'photo-catalog-query',
		...DEFAULT_PHOTO_LIBRARY_QUERY_V1, predicate: null });
	assert.equal(DEFAULT_PHOTO_LIBRARY_QUERY_V1.sort, DEFAULT_PHOTO_LIBRARY_QUERY_V2.sort);
	for (const query of [DEFAULT_PHOTO_LIBRARY_QUERY_V1, DEFAULT_PHOTO_LIBRARY_QUERY_V2]) {
		assert.ok(Object.isFrozen(query)); assert.ok(Object.isFrozen(query.sort));
	}
	assert.equal(isMetadataQuery(DEFAULT_PHOTO_LIBRARY_QUERY_V1), false);
	assert.equal(isMetadataQuery(DEFAULT_PHOTO_LIBRARY_QUERY_V2), true);
});

for (const version of [1, 2] as const) for (const collapsed of [false, true]) {
	test(`V${version} ${collapsed ? 'collapsed' : 'ordinary'} dispatch keeps request identities and receiver`, async () => {
		const query: PhotoLibraryQueryV1 | PhotoLibraryQueryV2 = version === 1
			? { ...DEFAULT_PHOTO_LIBRARY_QUERY_V1, text: 'live keywords' }
			: { ...DEFAULT_PHOTO_LIBRARY_QUERY_V2, text: 'live keywords', predicate: { kind: 'number', column: 'iso', minimum: 200, maximum: 800 } };
		const signal = new AbortController().signal, expected = step(); let calls = 0;
		const method = version === 1 ? collapsed ? 'readStackQueryStep' : 'readQueryStep'
			: collapsed ? 'readStackQueryStepV2' : 'readQueryStepV2';
		const owner = port({ [method]: async function (this: PhotoLibraryQueryNavigationPort,
			request: Readonly<{ query: PhotoLibraryQueryV1 | PhotoLibraryQueryV2; cursor?: string | null; signal?: AbortSignal }>) {
			assert.equal(this, owner); assert.equal(request.query, query); assert.equal(request.signal, signal);
			assert.equal(request.cursor, 'next'); calls++; return expected;
		} });
		assert.equal(await readQueryStep(owner, query, 'next', signal, collapsed), expected);
		assert.equal(calls, 1);
	});
}

test('plain all-photo navigation delegates directly while collapsed all-photo navigation uses default V2', async () => {
	const signal = new AbortController().signal, plain = page(); let all = 0, grouped = 0;
	const owner = port({ readPage: async function (request) {
		assert.equal(this, owner); assert.deepEqual(request, { cursor: 'all-next', signal }); all++; return plain;
	}, readStackQueryStepV2: async request => {
		assert.equal(request.query, DEFAULT_PHOTO_LIBRARY_QUERY_V2); assert.equal(request.cursor, null);
		assert.equal(request.signal, signal); grouped++; return step();
	} });
	assert.equal(await readVisiblePage(owner, { query: null, stackCollapsed: false }, 'all-next', signal), plain);
	const collapsed = await readVisiblePage(owner, { query: null, stackCollapsed: true }, null, signal);
	assert.deepEqual(collapsed, plain); assert.equal(Object.hasOwn(collapsed, 'scanned'), false);
	assert.equal(all, 1); assert.equal(grouped, 1);
});

test('sparse empty pages advance through yielded steps and publish only the four-field scalar page', async () => {
	const signal = new AbortController().signal, cursors: (string | null | undefined)[] = [];
	let taskDelivered = false;
	const timer = setTimeout(() => { taskDelivered = true; }, 0);
	try {
		const owner = port({ readQueryStepV2: async request => {
			cursors.push(request.cursor); assert.equal(request.query, DEFAULT_PHOTO_LIBRARY_QUERY_V2);
			if (cursors.length > 1) assert.equal(taskDelivered, true);
			return cursors.length === 1 ? step([], 'after-64') : cursors.length === 2 ? step([], 'after-128') : step([row], 'after-192');
		} });
		const result = await readVisiblePage(owner, { query: DEFAULT_PHOTO_LIBRARY_QUERY_V2, stackCollapsed: false }, null, signal);
		assert.deepEqual(cursors, [null, 'after-64', 'after-128']); assert.equal(result.rows[0], row);
		assert.equal(result.cursor, 'after-192'); assert.ok(Object.isFrozen(result));
		assert.deepEqual(Object.keys(result).sort(), ['catalogName', 'cursor', 'rows', 'totalCount']);
	} finally { clearTimeout(timer); }
});

test('an exhausted empty page is terminal and never requests another candidate step', async () => {
	let calls = 0;
	const owner = port({ readQueryStep: async () => { calls++; return step([], null); } });
	assert.deepEqual(await readNonemptyQueryPage(owner, DEFAULT_PHOTO_LIBRARY_QUERY_V1, null, new AbortController().signal), page([], null));
	assert.equal(calls, 1);
});

test('a nonadvancing empty continuation refuses before another port call', async () => {
	let calls = 0;
	const owner = port({ readStackQueryStep: async () => { calls++; return step([], 'stuck'); } });
	await assert.rejects(readNonemptyQueryPage(owner, DEFAULT_PHOTO_LIBRARY_QUERY_V1, 'stuck', new AbortController().signal, true),
		/continuation did not advance/u);
	assert.equal(calls, 1);
});

test('pre-cancellation prevents query work and held cancellation joins before rejecting the exact opaque reason', async () => {
	const reason = new Proxy({}, { get() { throw new Error('Opaque reason must not be read'); } });
	let calls = 0;
	const untouched = port({ readQueryStepV2: async () => { calls++; return step(); } });
	await rejectsExact(readNonemptyQueryPage(untouched, DEFAULT_PHOTO_LIBRARY_QUERY_V2, null, AbortSignal.abort(reason)), reason);
	assert.equal(calls, 0);
	let release: (value: PhotoLibraryQueryStepV1) => void = () => { throw new Error('Held request not registered'); };
	const held = new Promise<PhotoLibraryQueryStepV1>(resolve => { release = resolve; }), stop = new AbortController();
	const owner = port({ readQueryStepV2: async () => { calls++; return held; } });
	let settled = false;
	const work = readNonemptyQueryPage(owner, DEFAULT_PHOTO_LIBRARY_QUERY_V2, null, stop.signal);
	const observed = work.then(() => { settled = true; }, () => { settled = true; });
	stop.abort(reason); await Promise.resolve(); assert.equal(settled, false); assert.equal(calls, 1);
	release(step()); await rejectsExact(work, reason); await observed;
});

test('cancellation during the yielded sparse interval prevents the next request', async () => {
	const stop = new AbortController(), reason = Object.freeze({ cancelled: true }); let calls = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const owner = port({ readQueryStepV2: async () => {
		calls++; timer = setTimeout(() => { stop.abort(reason); }, 0); return step([], 'next');
	} });
	try {
		await assert.rejects(readNonemptyQueryPage(owner, DEFAULT_PHOTO_LIBRARY_QUERY_V2, null, stop.signal), error => error === reason);
		assert.equal(calls, 1);
	} finally { clearTimeout(timer); }
});

test('yieldTask crosses a task boundary and preserves native cancellation reason', async () => {
	let crossed = false;
	const pending = yieldTask(new AbortController().signal).then(() => { crossed = true; });
	await Promise.resolve(); assert.equal(crossed, false); await pending; assert.equal(crossed, true);
	await assert.rejects(yieldTask(AbortSignal.abort(17)), error => error === 17);
});

test('query errors retain exact identity and stop sparse traversal', async () => {
	const failure = Object.freeze({ backend: 'refused' }); let calls = 0;
	const owner = port({ readQueryStepV2: async () => { calls++; throw failure; } });
	await assert.rejects(readNonemptyQueryPage(owner, DEFAULT_PHOTO_LIBRARY_QUERY_V2, null, new AbortController().signal), error => error === failure);
	assert.equal(calls, 1);
});

for (const collapsed of [false, true]) test(`saved ${collapsed ? 'collapsed' : 'ordinary'} navigation dispatches only captured ID and mode`, async () => {
	const signal = new AbortController().signal; let calls = 0;
	const saved = savedPort(async function (this: PhotoLibrarySavedCollectionPortV1, request) {
		assert.equal(this, saved); assert.deepEqual(request, { collectionId: 'saved', mode: collapsed ? 'collapsed' : 'ordinary', cursor: 'saved-next', signal });
		calls++; return savedStep([row], null, request.mode);
	});
	const owner = { ...port(), savedCollections: saved };
	const context = { get query(): PhotoLibraryQueryV2 { throw new Error('Saved navigation cannot read caller criteria'); },
		stackCollapsed: collapsed, savedCollectionId: 'saved' };
	const result = await readVisiblePage(owner, context, 'saved-next', signal);
	assert.deepEqual(result, page()); assert.deepEqual(Object.keys(result).sort(), ['catalogName', 'cursor', 'rows', 'totalCount']);
	assert.ok(Object.isFrozen(result)); assert.equal(calls, 1);
});

test('saved sparse pages yield, stop at first result and retain no recipe or saved authority in the scalar page', async () => {
	const cursors: (string | null | undefined)[] = []; let yielded = false;
	const timer = setTimeout(() => { yielded = true; }, 0);
	try {
		const owner = { ...port(), savedCollections: savedPort(async request => {
			cursors.push(request.cursor); if (cursors.length > 1) assert.equal(yielded, true);
			return cursors.length === 1 ? savedStep([], 'saved-64') : cursors.length === 2 ? savedStep([], 'saved-128') : savedStep([row], 'saved-192');
		}) };
		const result = await readVisiblePage(owner, { query: null, stackCollapsed: false, savedCollectionId: 'saved' }, null, new AbortController().signal);
		assert.deepEqual(cursors, [null, 'saved-64', 'saved-128']); assert.deepEqual(result, page([row], 'saved-192'));
		assert.equal(Object.hasOwn(result, 'definitionRevision'), false); assert.equal(Object.hasOwn(result, 'context'), false);
	} finally { clearTimeout(timer); }
});

test('saved terminal empty pages stop, while nonadvancing empties refuse without another native read', async () => {
	let calls = 0;
	const owner = { ...port(), savedCollections: savedPort(async () => { calls++; return savedStep([], null); }) };
	assert.deepEqual(await readVisiblePage(owner, { query: null, stackCollapsed: false, savedCollectionId: 'saved' }, null, new AbortController().signal), page([]));
	assert.equal(calls, 1);
	owner.savedCollections = savedPort(async () => { calls++; return savedStep([], 'stuck'); });
	await assert.rejects(readVisiblePage(owner, { query: null, stackCollapsed: true, savedCollectionId: 'saved' }, 'stuck', new AbortController().signal), /continuation did not advance/u);
	assert.equal(calls, 2);
});

test('saved cancellation prevents pre-aborted reads and joins a held native step before rejecting exact reason', async () => {
	const reason = new Proxy({}, { get() { throw new Error('Opaque cancellation'); } }); let calls = 0;
	let release: (value: PhotoLibrarySavedCollectionQueryStepV1) => void = () => { throw new Error('Held step not registered'); };
	const held = new Promise<PhotoLibrarySavedCollectionQueryStepV1>(resolve => { release = resolve; });
	const owner = { ...port(), savedCollections: savedPort(async () => { calls++; return held; }) };
	const context = { query: null, stackCollapsed: false, savedCollectionId: 'saved' };
	await rejectsExact(readVisiblePage(owner, context, null, AbortSignal.abort(reason)), reason); assert.equal(calls, 0);
	const stop = new AbortController(); let settled = false;
	const work = readVisiblePage(owner, context, null, stop.signal), observed = work.then(() => { settled = true; }, () => { settled = true; });
	stop.abort(reason); await Promise.resolve(); assert.equal(settled, false); assert.equal(calls, 1);
	release(savedStep()); await rejectsExact(work, reason); await observed;
});

test('saved yielded cancellation and actual backend failures stop traversal', async () => {
	const stop = new AbortController(); let calls = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const owner = { ...port(), savedCollections: savedPort(async () => {
		calls++; timer = setTimeout(() => { stop.abort(17); }, 0); return savedStep([], 'next');
	}) };
	const context = { query: null, stackCollapsed: true, savedCollectionId: 'saved' };
	try { await rejectsExact(readVisiblePage(owner, context, null, stop.signal), 17); assert.equal(calls, 1); }
	finally { clearTimeout(timer); }
	const failure = Object.freeze({ backend: 'saved-refused' });
	owner.savedCollections = savedPort(async () => { calls++; throw failure; });
	await rejectsExact(readVisiblePage(owner, context, null, new AbortController().signal), failure); assert.equal(calls, 2);
});

test('missing saved capability refuses before any read and null/absent selection preserves direct all-photo behavior', async () => {
	let reads = 0;
	const owner = port({ readPage: async () => { reads++; return page(); }, readQueryStepV2: async () => { reads++; return step(); } });
	assert.throws(() => readVisiblePage(owner, { query: DEFAULT_PHOTO_LIBRARY_QUERY_V2, stackCollapsed: false, savedCollectionId: 'saved' }, null,
		new AbortController().signal), /Saved photo filters are unavailable/u);
	assert.equal(reads, 0);
	for (const context of [{ query: null, stackCollapsed: false }, { query: null, stackCollapsed: false, savedCollectionId: null }]) {
		assert.deepEqual(await readVisiblePage(owner, context, null, new AbortController().signal), page());
	}
	assert.equal(reads, 2);
});
