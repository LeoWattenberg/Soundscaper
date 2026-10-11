/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { PhotoLibrarySessionV2 } from '../src/lightscaper/controller/photo-library-session-v2.ts';
import type { PhotoLibrarySessionPortsV2 } from '../src/lightscaper/controller/photo-library-session-ports-v2.ts';
import type { PhotoLibraryCullingNavigationContextV1 } from '../src/common/editor/photo-library-culling-navigation-port-v1.ts';
import { normalizePhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { currentDevelopFixture } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });

const query = normalizePhotoCatalogQueryV2();
async function fixture() {
	const f = await currentDevelopFixture(2), calls = { initialize: 0, close: 0 };
	const ports: PhotoLibrarySessionPortsV2 = { catalog: f.repository, stacks: f.repository, smartCollections: f.repository,
		initialize: async () => { calls.initialize++; return (await f.repository.loadCatalog('catalog-1'))!; },
		closeResources: async () => { calls.close++; await f.close(); }, journal: f.settings, settings: f.settings,
		media: { writeAsset: async () => { throw new Error('Unexpected media write'); }, custody: {
			findDigestPage: async () => ({ matches: [], afterAssetId: null }), stage: async () => undefined, promote: async () => undefined,
			releaseStaged: async () => undefined, readPage: async () => ({ roots: [], afterKey: null }) } } };
	return { ...f, calls, ports };
}

test('current Session destination pins criteria and the native method receiver before held initialization', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	const read = f.repository.readCullingDestinationPage, initialize = f.ports.initialize;
	f.repository.readCullingDestinationPage = function (...args) { assert.equal(this, f.repository); return read.apply(this, args); };
	const session = new PhotoLibrarySessionV2({ ...f.ports, initialize: async signal => { entered.resolve(); await release.promise; return initialize(signal); } });
	assert.ok(session.cullingNavigation);
	const mutable = { kind: 'query' as const, query: { ...query, filter: null as { kind: 'rating'; value: number } | null }, collapsed: false };
	const request = { photoId: f.photos[0]!.id }, work = session.cullingNavigation.readDestinationPage(mutable, request);
	await entered.promise; mutable.query.filter = { kind: 'rating', value: 5 }; request.photoId = 'missing';
	f.repository.readCullingDestinationPage = async () => { throw new Error('Substituted reader'); };
	release.resolve();
	try { const page = await work; assert.equal(page?.rows[0]?.id, f.photos[0]!.id); assert.equal(f.calls.initialize, 1); }
	finally { release.resolve(); await Promise.allSettled([work]); await session.close(); }
});

test('closed request refusal precedes Session acquisition and never invokes caller getters', async () => {
	const f = await fixture(), session = new PhotoLibrarySessionV2(f.ports); assert.ok(session.cullingNavigation);
	let getters = 0;
	try {
		const hostile = { get photoId() { getters++; return f.photos[0]!.id; } };
		await assert.rejects(async () => session.cullingNavigation!.readDestinationPage({ kind: 'plain' }, hostile));
		await assert.rejects(async () => session.cullingNavigation!.readDestinationPage({ kind: 'plain' }, { photoId: f.photos[0]!.id, signal: {} as AbortSignal }));
		await assert.rejects(async () => session.cullingNavigation!.readDestinationPage({ kind: 'query', query: { ...query, schemaVersion: 3 }, collapsed: false } as unknown as PhotoLibraryCullingNavigationContextV1,
			{ photoId: f.photos[0]!.id }));
		await assert.rejects(async () => session.cullingNavigation!.readDestinationPage({ kind: 'plain' }, { photoId: f.photos[0]!.id, cursor: 'stale' } as { photoId: string }));
		assert.equal(getters, 0); assert.equal(f.calls.initialize, 0);
	} finally { await session.close(); }
});

test('Close joins a held actual native read and prevents late scalar publication', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), read = f.repository.readCullingDestinationPage;
	f.repository.readCullingDestinationPage = async function (...args) { const page = await read.apply(this, args); entered.resolve(); await release.promise; return page; };
	const session = new PhotoLibrarySessionV2(f.ports); assert.ok(session.cullingNavigation);
	const work = session.cullingNavigation.readDestinationPage({ kind: 'plain' }, { photoId: f.photos[0]!.id });
	await entered.promise; const refused = assert.rejects(work, { name: 'AbortError' }), closing = session.close();
	try {
		assert.equal(await remainsPending(closing), true); assert.equal(f.calls.close, 0);
		release.resolve(); await refused; await closing; assert.equal(f.calls.close, 1);
	} finally { release.resolve(); await Promise.allSettled([work]); await session.close(); }
});

test('caller cancellation retains an opaque native reason while the held reader and Session remain joined', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), read = f.repository.readCullingDestinationPage;
	f.repository.readCullingDestinationPage = async function (...args) { const page = await read.apply(this, args); entered.resolve(); await release.promise; return page; };
	const session = new PhotoLibrarySessionV2(f.ports), caller = new AbortController(), reason = Symbol('cancel'); assert.ok(session.cullingNavigation);
	const work = session.cullingNavigation.readDestinationPage({ kind: 'plain' }, { photoId: f.photos[0]!.id, signal: caller.signal });
	await entered.promise; caller.abort(reason);
	try {
		assert.equal(await remainsPending(work), true); release.resolve();
		let failure: unknown; try { await work; } catch (error) { failure = error; } assert.equal(failure, reason);
		f.repository.readCullingDestinationPage = read;
		assert.equal((await session.cullingNavigation.readDestinationPage({ kind: 'plain' }, { photoId: f.photos[1]!.id }))?.rows[0]?.id, f.photos[1]!.id);
	} finally { release.resolve(); await Promise.allSettled([work]); await session.close(); }
});
