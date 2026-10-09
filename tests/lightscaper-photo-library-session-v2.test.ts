/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibrarySessionV2 } from '../src/lightscaper/controller/photo-library-session-v2.ts';
import type { PhotoLibrarySessionPortsV2 } from '../src/lightscaper/controller/photo-library-session-ports-v2.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { currentDevelopFixture, currentRecipe } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import type { PhotoMediaCubeLutResourcesV1 } from '../src/lightscaper/storage/photo-media-cube-lut-resources-v1.ts';
import { LUT_BODY, LUT_REFERENCE } from './helpers/lightscaper-lut-archive-fixture.ts';

async function fixture() {
	const f = await currentDevelopFixture(1);
	const ports: PhotoLibrarySessionPortsV2 = {
		catalog: f.repository, stacks: f.repository, smartCollections: f.repository,
		initialize: async () => { const root = await f.repository.loadCatalog('catalog-1'); if (!root) throw new Error('Missing fixture root'); return root; },
		closeResources: () => f.close(), journal: f.settings, settings: f.settings,
		media: { writeAsset: async () => { throw new Error('Unexpected media write'); }, custody: {
			findDigestPage: async () => ({ matches: [], afterAssetId: null }), stage: async () => undefined, promote: async () => undefined,
			releaseStaged: async () => undefined, readPage: async () => ({ roots: [], afterKey: null }),
		} },
	};
	return { ...f, ports };
}

test('actual current Session keeps full mixed records through metadata, attributes and Develop commands', async () => {
	const f = await fixture(), before = f.photos[0]!;
	const current = normalizePhotoDocumentV2({ ...before, schemaVersion: 2,
		versions: [{ ...before.versions[0]!, develop: currentRecipe(null) }] });
	await f.repository.savePhoto(current, before.revision);
	const session = new PhotoLibrarySessionV2(f.ports);
	try {
		assert.equal(session.develop.schemaVersion, 2);
		const snapshot = await session.readMetadata(current.id);
		await session.applyMetadata(current.id, snapshot.revision, { title: 'Authored' });
		await session.setRating(current.id, 5);
		const saved = await f.repository.loadPhoto(current.catalogId, current.id);
		assert.ok(saved); assert.equal(saved.schemaVersion, 2); assert.equal(saved.metadata.title, 'Authored');
		assert.deepEqual(saved.original, current.original); assert.deepEqual(saved.extractedMetadata, current.extractedMetadata);
		assert.deepEqual(saved.versions, current.versions);
		const develop = await session.develop.read({ schemaVersion: 2, photoId: current.id });
		assert.equal(develop.develop.processVersion, 2);
		assert.equal((await session.readPage()).rows[0]?.rating, 5);
	} finally { await session.close(); }
});

test('actual current Session Close joins held initialization before releasing selected resources', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(); let closed = 0;
	const initialize = f.ports.initialize;
	f.ports = { ...f.ports, initialize: async signal => { entered.resolve(); await release.promise;
		signal.throwIfAborted(); return initialize(signal); }, closeResources: async () => { closed++; await f.close(); } };
	const session = new PhotoLibrarySessionV2(f.ports), work = session.readPage();
	const result = work.then(() => false, error => error instanceof DOMException && error.name === 'AbortError');
	try {
		await entered.promise; const closing = session.close(); assert.equal(session.close(), closing);
		await remainsPending(closing); assert.equal(closed, 0);
		await assert.rejects(session.readPage(), /closed/u);
		release.resolve(); await closing; assert.equal(await result, true); assert.equal(closed, 1);
	} finally { release.resolve(); await session.close(); }
});

test('actual current Session preserves a known save when its lease callback aborts and closes late', async () => {
	const f = await fixture(), caller = new AbortController(); let closing: Promise<void> | null = null;
	let armed = false;
	const reason = new Proxy({}, { get() { throw new Error('Opaque reason reflected'); } });
	f.ports = { ...f.ports, exclusive: async (_id, run, signal) => {
		const result = await run(signal); if (armed) { caller.abort(reason); closing = session.close(); } return result;
	} };
	const session = new PhotoLibrarySessionV2(f.ports);
	try {
		await session.readPage(); armed = true;
		const saved = await session.setRating('photo-1', 4, { signal: caller.signal });
		assert.equal(saved.rating, 4); assert.ok(closing); await closing;
		assert.equal(f.raw.recordCount('current-develop-session', 'photos'), 1);
	} finally { await session.close(); }
});

test('actual current Session captures each selected receiver once before hostile initialization changes it', async () => {
	const f = await fixture(), initialize = f.ports.initialize; let reads = 0;
	const catalog = f.ports.catalog;
	f.ports = { ...f.ports, initialize: async signal => {
		Object.defineProperty(catalog, 'readSummaryPage', { configurable: true, get() { throw new Error('Replaced selected capability'); } });
		return initialize(signal);
	} };
	Object.defineProperty(f.ports, 'catalog', { get() { reads++; if (reads > 1) throw new Error('Repeated selected receiver'); return catalog; } });
	const session = new PhotoLibrarySessionV2(f.ports);
	try { assert.equal((await session.readPage()).rows.length, 1); assert.equal(reads, 1); }
	finally { await session.close(); }
});

test('a cold actual Session detaches the complete LUT reference before returning its byte operation', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), initialize = f.ports.initialize;
	const resources: PhotoMediaCubeLutResourcesV1 = {
		source: { async withBytes(reference, consume) {
			assert.deepEqual(reference, LUT_REFERENCE); return await consume(LUT_BODY.slice());
		} },
		put: async () => { throw new Error('Unexpected LUT write'); }, importFile: async () => { throw new Error('Unexpected LUT import'); },
		verifyPhoto: async () => undefined, verifyPreset: async () => undefined,
	};
	f.ports = { ...f.ports, initialize: async signal => { entered.resolve(); await release.promise; return initialize(signal); }, cubeLutResources: async () => resources };
	const session = new PhotoLibrarySessionV2(f.ports);
	const reference = { ...LUT_REFERENCE, domainMin: [0, 0, 0] as [number, number, number], domainMax: [1, 1, 1] as [number, number, number] };
	const work = session.cubeLuts.source.withBytes(reference, bytes => { assert.deepEqual(bytes, LUT_BODY); return 'admitted bytes'; });
	const observed = work.then(value => ({ value }), error => ({ error: error as unknown }));
	try {
		reference.storageKey = 'lut-sha256:post-call'; reference.domainMin[0] = -1;
		await entered.promise; reference.domainMax[2] = 2; release.resolve();
		assert.deepEqual(await observed, { value: 'admitted bytes' });
	} finally { release.resolve(); await session.close(); }
});

test('an invalid LUT consumer is refused before cold Session initialization or selected resource acquisition', async () => {
	const f = await fixture(), initialize = f.ports.initialize; let initialized = 0, acquired = 0;
	f.ports = { ...f.ports, initialize: async signal => { initialized++; return initialize(signal); },
		cubeLutResources: async () => { acquired++; throw new Error('Unexpected LUT acquisition'); } };
	const session = new PhotoLibrarySessionV2(f.ports);
	try {
		await assert.rejects(session.cubeLuts.source.withBytes(LUT_REFERENCE, undefined as unknown as (bytes: Uint8Array<ArrayBuffer>) => void), TypeError);
		assert.equal(initialized, 0); assert.equal(acquired, 0);
	} finally { await session.close(); }
});

test('native pre-abort wins LUT reference reflection without initializing the actual Session', async () => {
	const f = await fixture(), caller = new AbortController(); let reflections = 0, initialized = 0;
	const reason = new Proxy({}, { get() { reflections++; throw new Error('Opaque reason reflected'); } });
	const reference = new Proxy(LUT_REFERENCE, { getOwnPropertyDescriptor() { reflections++; throw new TypeError('Reference reflected'); } });
	f.ports = { ...f.ports, initialize: async () => { initialized++; throw new Error('Unexpected initialization'); } };
	const session = new PhotoLibrarySessionV2(f.ports); caller.abort(reason);
	try {
		let observed: unknown;
		try { await session.cubeLuts.source.withBytes(reference, () => undefined, { signal: caller.signal }); }
		catch (error) { observed = error; }
		assert.equal(observed === reason, true); assert.equal(reflections, 0); assert.equal(initialized, 0);
	} finally { await session.close(); }
});
