/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { importPhotoCatalogArchiveV3 } from '../src/lightscaper/archive/catalog-archive-import-v3.ts';
import { exportPhotoCatalogArchiveV1 } from '../src/lightscaper/archive/catalog-archive-export.ts';
import { exportPhotoCatalogArchiveV2 } from '../src/lightscaper/archive/catalog-archive-export-v2.ts';
import { createBlobScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { stackArchiveRoot, stackArchiveDestination } from './helpers/lightscaper-stack-archive-fixture.ts';
import { editStackArchiveDocument as editDocument, rewriteStackArchive as rewrite, stackArchiveFailure as hasFailure,
	stackArchiveRecord } from './helpers/lightscaper-stack-archive-fixture.ts';
import { savedArchiveDefinitionV3 as definition, savedArchiveRootV3 as root, savedArchiveStateV3 as state,
	savedArchiveFixtureV3 as archive, savedArchiveDestinationV3 as destination,
	savedArchiveReaderV3 as reader, savedArchiveDeferredV3 as deferred } from './helpers/lightscaper-saved-collection-archive-fixture.ts';

test('V3 imports independently admitted V1 with explicit absent saved authority', async () => {
	const root = stackArchiveRoot(0), archive = await exportPhotoCatalogArchiveV1(root, []);
	assert.ok(archive.blob); const target = stackArchiveDestination();
	assert.deepEqual(await importPhotoCatalogArchiveV3(archive.blob, async (capturedRoot, state) => {
		assert.deepEqual(capturedRoot, root); assert.equal(state, null);
		return { ...target.stage, async writeSavedCollection() { assert.fail('No saved records in V1.'); } };
	}), root);
	assert.deepEqual(target.events, ['publish']);
});

test('V3 independently admits unchanged V2 photos and stacks with no synthesized saved state', async () => {
	const source = [photoArchiveFixture(1), photoArchiveFixture(2)], archivedRoot = stackArchiveRoot(2);
	const exported = await exportPhotoCatalogArchiveV2(archivedRoot, source, [stackArchiveRecord()]); assert.ok(exported.blob);
	const target = destination();
	assert.deepEqual(await importPhotoCatalogArchiveV3(exported.blob, async (captured, retained) => {
		assert.deepEqual(captured, archivedRoot); assert.equal(retained, null); return target.stage;
	}), archivedRoot);
	assert.equal(target.photos.size, 2); assert.deepEqual([...target.stacks.values()], [stackArchiveRecord()]);
	assert.equal(target.saved.size, 0); assert.equal(target.events.at(-1), 'publish');
});

test('V3 streams unchanged root/photo/stack/saved revisions and all complete Query2 fields', async () => {
	const recipe = definition('saved-1', { kind: 'all', terms: [
		{ kind: 'not', term: { kind: 'any', terms: [{ kind: 'folder', id: 'folder' }, { kind: 'keyword', id: 'keyword' }] } },
		{ kind: 'text', column: 'camera-make', operator: 'equals', value: 'Canon' },
		{ kind: 'number', column: 'iso', minimum: 100, maximum: 400 },
		{ kind: 'time', column: 'capture-time', from: '2026-10-08T00:00:00.000', to: null },
		{ kind: 'presence', column: 'lens', value: 'unknown' },
	] });
	const bytes = await archive([[recipe]]), target = destination();
	assert.deepEqual(await importPhotoCatalogArchiveV3(createBlobScapeArchiveByteSource(bytes), async (captured, retained) => {
		assert.deepEqual(captured, root()); assert.deepEqual(retained, state(1));
		assert.ok(Object.isFrozen(captured)); assert.ok(Object.isFrozen(retained)); return target.stage;
	}), root());
	assert.equal(target.photos.get('photo-1')?.photo.revision, 13); assert.equal(target.photos.get('photo-2')?.photo.revision, 14);
	assert.deepEqual(target.photos.get('photo-1')?.bytes, new Uint8Array([1, 2, 3]));
	assert.deepEqual([...target.stacks.values()], [stackArchiveRecord()]); assert.deepEqual([...target.saved.values()], [recipe]);
	assert.deepEqual(Object.keys(target.saved.get('saved-1')!.query), ['schemaVersion', 'kind', 'text', 'filter', 'sort', 'predicate']);
	assert.deepEqual(target.events, ['photo:photo-1', 'photo:photo-2', 'stack:stack-1', 'saved:saved-1', 'publish']);
});

test('V3 distinguishes physical absence, persisted zero and last-delete tombstone exactly', async () => {
	for (const retained of [null, state(0, 0), state(0, 99)]) {
		const target = destination();
		await importPhotoCatalogArchiveV3(await archive([], retained, root(0)), async (captured, actual) => {
			assert.deepEqual(captured, root(0)); assert.deepEqual(actual, retained); return target.stage;
		});
		assert.deepEqual(target.events, ['publish']);
	}
});

test('cross-pack saved IDs are global while one-record delivery preserves all 70 definitions', async () => {
	const records = Array.from({ length: 70 }, (_, index) => definition(`saved-${index}`)), target = destination();
	await importPhotoCatalogArchiveV3(await archive([records.slice(0, 64), records.slice(64)]), async () => target.stage);
	assert.deepEqual([...target.saved.values()], records); assert.equal(target.events.filter(event => event === 'publish').length, 1);
	const duplicate = destination();
	await assert.rejects(importPhotoCatalogArchiveV3(await archive([[definition()], [definition()]]), async () => duplicate.stage), error => hasFailure(error, /duplicate/iu));
	assert.equal(duplicate.events.filter(event => event.startsWith('saved:')).length, 1);
	assert.equal(duplicate.events.at(-1), 'rollback'); assert.equal(duplicate.saved.size, 0); assert.equal(duplicate.photos.size, 0);
});

test('all branches and root-only references refuse foreign, disjointness and hidden missing authority before saved staging', async () => {
	const missing = definition('saved-1', { kind: 'any', terms: [{ kind: 'rating', minimum: 0, maximum: 5 },
		{ kind: 'not', term: { kind: 'all', terms: [{ kind: 'folder', id: 'folder' }, { kind: 'keyword', id: 'missing' }] } }] });
	for (const candidate of [missing, definition('root-collection'), { ...definition(), catalogId: 'foreign' },
		{ ...definition(), query: { ...definition().query, filter: { kind: 'collection', id: 'another-saved' } } }]) {
		const target = destination();
		await assert.rejects(importPhotoCatalogArchiveV3(await archive([[candidate]]), async () => target.stage), error => hasFailure(error, /missing|disjoint|catalog/iu));
		assert.equal(target.events.filter(event => event.startsWith('saved:')).length, 0);
		assert.equal(target.events.at(-1), 'rollback'); assert.equal(target.photos.size, 0); assert.equal(target.stacks.size, 0);
	}
});

test('authenticated incomplete or future recipes refuse rather than inventing Query2 defaults', async () => {
	for (const field of ['text', 'filter', 'sort', 'predicate']) {
		const query: Record<string, unknown> = { ...definition().query }; delete query[field]; const target = destination();
		await assert.rejects(importPhotoCatalogArchiveV3(await archive([[{ ...definition(), query }]]), async () => target.stage));
		assert.equal(target.events.some(event => event.startsWith('saved:')), false); assert.equal(target.events.at(-1), 'rollback');
	}
	const target = destination();
	await assert.rejects(importPhotoCatalogArchiveV3(await archive([[{ ...definition(), schemaVersion: 2 }]]), async () => target.stage), error => hasFailure(error, /future|version/iu));
	assert.equal(target.events.at(-1), 'rollback');
});

test('manifest/version/physical-state errors refuse before destination acquisition', async () => {
	const valid = await archive();
	for (const mutate of [
		(document: Record<string, unknown>) => { delete document.savedCollectionState; },
		(document: Record<string, unknown>) => { document.savedCollectionState = null; },
		(document: Record<string, unknown>) => { document.savedCollectionState = state(2); },
		(document: Record<string, unknown>) => { document.schemaVersion = 4; },
		(document: Record<string, unknown>) => { document.schemaFamily = 'framescaper'; },
	]) await assert.rejects(importPhotoCatalogArchiveV3(await rewrite(valid, entries => { editDocument(entries, mutate); }), async () => {
		assert.fail('Malformed authority cannot acquire a stage.');
	}));
	await assert.rejects(importPhotoCatalogArchiveV3(await rewrite(valid, entries => {
		const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json'))) as { assets: { kind: string; encoding: string }[] };
		manifest.assets.at(-1)!.encoding = 'future'; entries.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
	}), async () => { assert.fail('Malformed descriptors cannot acquire a stage.'); }), /descriptor/iu);
});

test('old V1/V2 bodies remain closed and cannot smuggle V3 authority fields', async () => {
	const old = await exportPhotoCatalogArchiveV1(stackArchiveRoot(0), []); assert.ok(old.blob);
	await assert.rejects(importPhotoCatalogArchiveV3(await rewrite(old.blob, entries => {
		editDocument(entries, document => { document.savedCollectionState = null; document.savedCollectionPacks = []; });
	}), async () => { assert.fail('Old bodies retain their owning exact schema.'); }), /unsupported field/iu);
});

test('valid saved tampering reaches provisional writes then fails its original digest and rolls all kinds back', async () => {
	const target = destination(), corrupt = await rewrite(await archive(), entries => {
		const entry = 'assets/saved-collection-pack-000001.bin', bytes = entries.get(entry)!.slice();
		const text = new TextDecoder().decode(bytes.subarray(12)).replace('"revision":17', '"revision":18');
		bytes.set(new TextEncoder().encode(text), 12); entries.set(entry, bytes);
	});
	await assert.rejects(importPhotoCatalogArchiveV3(corrupt, async () => target.stage), /SHA-256|digest/iu);
	assert.ok(target.events.includes('saved:saved-1')); assert.equal(target.events.at(-1), 'rollback');
	assert.equal(target.photos.size + target.stacks.size + target.saved.size, 0); assert.equal(target.events.includes('publish'), false);
});

test('authenticated per-pack and physical counts bind actual delivery before publication', async () => {
	const target = destination(), corrupt = await rewrite(await archive(), entries => {
		editDocument(entries, document => { document.savedCollectionState = state(2);
			(document.savedCollectionPacks as { collectionCount: number }[])[0]!.collectionCount = 2; });
	});
	await assert.rejects(importPhotoCatalogArchiveV3(corrupt, async () => target.stage), /count/iu);
	assert.ok(target.events.includes('saved:saved-1')); assert.equal(target.events.at(-1), 'rollback'); assert.equal(target.saved.size, 0);
});

test('cancelled held stage acquisition joins the factory then rolls back without a record or publication', async () => {
	const target = destination(), acquired = deferred(), release = deferred(), stop = new AbortController(), reason = new Error('cancel acquisition');
	const bytes = await archive(); let settled = false;
	const operation = importPhotoCatalogArchiveV3(bytes, async () => { acquired.resolve(); await release.promise; return target.stage; }, { signal: stop.signal });
	void operation.then(() => { settled = true; }, () => { settled = true; }); await acquired.promise; stop.abort(reason);
	await new Promise<void>(resolve => { setImmediate(resolve); }); assert.equal(settled, false); assert.deepEqual(target.events, []);
	release.resolve(); await assert.rejects(operation, error => hasFailure(error, /cancel acquisition/iu)); assert.deepEqual(target.events, ['rollback']);
});

test('cancelled held saved consumer and rollback are joined before failure escapes', async () => {
	const target = destination(), entered = deferred(), release = deferred(), rolled = deferred(), cleanup = deferred(), stop = new AbortController();
	const bytes = await archive(); let settled = false;
	const operation = importPhotoCatalogArchiveV3(bytes, async () => ({ ...target.stage,
		async writeSavedCollection(value) { await target.stage.writeSavedCollection(value); entered.resolve(); await release.promise; },
		async rollback() { rolled.resolve(); await cleanup.promise; await target.stage.rollback(); },
	}), { signal: stop.signal });
	void operation.then(() => { settled = true; }, () => { settled = true; }); await entered.promise; stop.abort();
	await new Promise<void>(resolve => { setImmediate(resolve); }); assert.equal(settled, false); assert.equal(target.events.includes('rollback'), false);
	release.resolve(); await rolled.promise; assert.equal(settled, false); assert.equal(target.events.includes('publish'), false);
	cleanup.resolve(); await assert.rejects(operation, { name: 'AbortError' }); assert.equal(target.events.at(-1), 'rollback');
});

test('ZIP extraction remains joined after the last saved callback before publication', async () => {
	const target = destination(), extracted = deferred(), release = deferred(); let settled = false;
	const operation = importPhotoCatalogArchiveV3(await archive(), async () => target.stage, { readerFactories: {
		blob: reader(async () => {}, async name => { if (name.includes('saved-collection-pack')) { extracted.resolve(); await release.promise; } }),
	} });
	void operation.then(() => { settled = true; }, () => { settled = true; }); await extracted.promise;
	assert.ok(target.events.includes('saved:saved-1')); assert.equal(settled, false); assert.equal(target.events.includes('publish'), false);
	release.resolve(); await operation; assert.equal(target.events.at(-1), 'publish');
});

test('held ZIP cleanup gates publication and cancellation during cleanup refuses the complete provisional catalog', async () => {
	for (const cancel of [false, true]) {
		const target = destination(), closing = deferred(), release = deferred(), stop = new AbortController(); let closed = false, settled = false;
		const operation = importPhotoCatalogArchiveV3(await archive(), async () => ({ ...target.stage,
			async publish() { assert.equal(closed, true); await target.stage.publish(); },
		}), { signal: stop.signal, readerFactories: { blob: reader(async () => { closing.resolve(); await release.promise; closed = true; }) } });
		void operation.then(() => { settled = true; }, () => { settled = true; }); await closing.promise;
		assert.ok(target.events.includes('saved:saved-1')); assert.equal(settled, false); assert.equal(target.events.includes('publish'), false);
		if (cancel) stop.abort(); release.resolve();
		if (cancel) { await assert.rejects(operation, { name: 'AbortError' }); assert.equal(target.events.at(-1), 'rollback'); }
		else { assert.deepEqual(await operation, root()); assert.equal(target.events.at(-1), 'publish'); }
	}
});

test('reader cleanup and stage failures aggregate rollback failure without publication', async () => {
	for (const location of ['reader', 'saved', 'publish'] as const) {
		const target = destination(), primary = new Error(`${location} failed`), cleanup = new Error('rollback failed');
		await assert.rejects(importPhotoCatalogArchiveV3(await archive(), async () => ({ ...target.stage,
			async writeSavedCollection(value) { if (location === 'saved') throw primary; await target.stage.writeSavedCollection(value); },
			async publish() { throw primary; }, async rollback() { await target.stage.rollback(); throw cleanup; },
		}), { readerFactories: { blob: reader(async () => { if (location === 'reader') throw primary; }) } }),
			error => error instanceof AggregateError && containsError(error, primary) && containsError(error, cleanup));
		assert.equal(target.events.at(-1), 'rollback'); assert.equal(target.events.includes('publish'), false);
	}
});

test('a successful publish ACK wins an abort arriving with that ACK and is never rolled back', async () => {
	const target = destination(), entered = deferred(), release = deferred(), stop = new AbortController(); let settled = false;
	const operation = importPhotoCatalogArchiveV3(await archive(), async () => ({ ...target.stage,
		async publish() { entered.resolve(); await release.promise; await target.stage.publish(); stop.abort(new Error('late cancellation')); },
	}), { signal: stop.signal });
	void operation.then(() => { settled = true; }, () => { settled = true; }); await entered.promise;
	assert.equal(settled, false); assert.equal(target.events.includes('publish'), false); release.resolve();
	assert.deepEqual(await operation, root()); assert.equal(target.events.at(-1), 'publish'); assert.equal(target.events.includes('rollback'), false);
	assert.equal(target.photos.size, 2); assert.equal(target.stacks.size, 1); assert.equal(target.saved.size, 1);
});

test('an incomplete stage is refused and its available rollback is joined', async () => {
	let rolled = false;
	await assert.rejects(importPhotoCatalogArchiveV3(await archive(), async () => ({ ...destination().stage,
		writeSavedCollection: undefined, async rollback() { rolled = true; },
	}) as unknown as ReturnType<typeof destination>['stage']), /incomplete/iu); assert.equal(rolled, true);
});

function containsError(value: unknown, expected: unknown): boolean {
	return value === expected || value instanceof AggregateError && (value.errors as unknown[]).some(error => containsError(error, expected));
}
