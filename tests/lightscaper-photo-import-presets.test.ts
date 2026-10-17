/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { readPhotoImportPresetsV1, applyPhotoImportPresetV1, normalizePhotoImportPresetRowV1,
	normalizePhotoImportPresetCommandV1, photoImportPresetsKeyV1, PHOTO_IMPORT_PRESETS_MAXIMUM_BYTES_V1 } from '../src/lightscaper/storage/photo-import-presets-v1.ts';
import { queryCatalogRootV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { deferred } from './helpers/async-test-control.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';

const recipe = { rename: null, metadata: {}, keywordIds: ['keyword'] };
const save = (revision = 0, id = 'preset') => ({ type: 'save', expectedRevision: revision, id, name: 'Import recipe', settings: recipe });
function fixture() {
	const repository = new KeyValueRepository({ memory: getMemoryDatabase(`photo-presets-${crypto.randomUUID()}`), database: async () => null }, 'settings');
	const calls: string[] = [];
	const port = {
		get: async (key: string) => { calls.push(`get:${key}`); return repository.get(key); },
		putIfAbsent: async (key: string, value: unknown) => { calls.push('create'); return repository.putIfAbsent(key, value); },
		replaceIfCurrent: async (key: string, expected: unknown, value: unknown) => { calls.push('replace'); return repository.replaceIfCurrent(key, expected, value); },
	};
	return { repository, port, calls, root: queryCatalogRootV1(), key: photoImportPresetsKeyV1('catalog') };
}

test('preset CAS creates, updates and retains an empty-row revision without touching other settings', async () => {
	const f = fixture(); await f.repository.put('unrelated', { keep: true });
	assert.deepEqual(await readPhotoImportPresetsV1(f.port, 'catalog'), { revision: 0, presets: [] });
	const created = await applyPhotoImportPresetV1(f.port, f.root, save());
	assert.equal(created.revision, 1); assert.equal(created.presets.length, 1);
	await assert.rejects(applyPhotoImportPresetV1(f.port, f.root, save()), { code: 'IMPORT_PRESET_REVISION_CONFLICT' });
	const edited = await applyPhotoImportPresetV1(f.port, f.root, { ...save(1), name: 'Changed' });
	assert.equal(edited.revision, 2); assert.equal(edited.presets[0]?.name, 'Changed');
	const cleared = await applyPhotoImportPresetV1(f.port, f.root, { type: 'delete', expectedRevision: 2, id: 'preset' });
	assert.deepEqual(cleared, { revision: 3, presets: [] });
	assert.equal((await applyPhotoImportPresetV1(f.port, f.root, save(3))).revision, 4);
	assert.deepEqual(await f.repository.get('unrelated'), { keep: true });
	assert.equal(f.calls.filter(call => call === 'create').length, 1);
});

test('two independent first writers have one CAS winner and no silent retry', async () => {
	const f = fixture();
	const results = await Promise.allSettled([applyPhotoImportPresetV1(f.port, f.root, save(0, 'a')), applyPhotoImportPresetV1(f.port, f.root, save(0, 'b'))]);
	assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
	assert.equal((await readPhotoImportPresetsV1(f.port, 'catalog')).presets.length, 1);
	assert.equal(f.calls.filter(call => call === 'create').length, 2);
});

test('sixteen maximal valid recipes fit the proven whole UTF8 row cap, including escaped lone surrogates', async () => {
	const maxId = (index: number) => `k${String(index).padStart(4, '0')}${'a'.repeat(123)}`;
	const text = '\ud800'.repeat(16_384);
	const settings = { rename: { template: '\ud800'.repeat(256), sequenceStart: Number.MAX_SAFE_INTEGER - 63, sequencePadding: 16 },
		metadata: { title: text, caption: text, creator: text, copyright: text, location: text }, keywordIds: Array.from({ length: 1024 }, (_, index) => maxId(index)) };
	const row = { schemaVersion: 1, kind: 'photo-import-presets', catalogId: 'c'.repeat(128), revision: Number.MAX_SAFE_INTEGER,
		presets: Array.from({ length: 16 }, (_, index) => ({ id: maxId(index), name: '\ud800'.repeat(256), settings })) };
	assert.equal(new TextEncoder().encode(JSON.stringify(settings)).byteLength, 627_374);
	assert.equal(new TextEncoder().encode(JSON.stringify(row)).byteLength, 10_065_352);
	assert.equal(PHOTO_IMPORT_PRESETS_MAXIMUM_BYTES_V1, 10_485_760);
	const normalized = normalizePhotoImportPresetRowV1(row, row.catalogId);
	assert.equal(new TextEncoder().encode(JSON.stringify(normalized)).byteLength, 10_065_352);
	assert.equal(normalized.presets.length, 16);
	assert.throws(() => normalizePhotoImportPresetRowV1({ ...row, presets: [...row.presets, row.presets[0]] }, row.catalogId));
});

test('future/corrupt rows, stale keywords, hostile getters and abort refuse without writes', async () => {
	let invoked = 0;
	const hostile = Object.defineProperty(save(), 'name', { enumerable: true, get: () => { invoked++; return 'X'; } });
	assert.throws(() => normalizePhotoImportPresetCommandV1(hostile));
	assert.equal(invoked, 0);
	for (const value of [null, { schemaVersion: 2, kind: 'photo-import-presets', catalogId: 'catalog', revision: 1, presets: [] },
		{ schemaVersion: 1, kind: 'photo-import-presets', catalogId: 'foreign', revision: 1, presets: [] }]) {
		const f = fixture(); await f.repository.put(f.key, value);
		await assert.rejects(readPhotoImportPresetsV1(f.port, 'catalog')); await assert.rejects(applyPhotoImportPresetV1(f.port, f.root, save()));
		assert.equal(f.calls.includes('create'), false); assert.equal(f.calls.includes('replace'), false);
	}
	const f = fixture();
	await assert.rejects(applyPhotoImportPresetV1(f.port, { ...f.root, keywords: [], collections: [] }, save()), /keyword/iu);
	assert.deepEqual(f.calls, []);
	const signal = Object.defineProperty(AbortSignal.abort(), 'throwIfAborted', { get: () => { invoked++; return () => undefined; } });
	await assert.rejects(readPhotoImportPresetsV1(f.port, 'catalog', { signal }), { name: 'AbortError' });
	assert.equal(invoked, 0); assert.equal(f.calls.length, 0);
});

test('an acknowledged CAS wins late cancellation and lost acknowledgments reconcile only the exact intended row', async () => {
	const f = fixture(), abort = new AbortController(), create = f.port.putIfAbsent;
	f.port.putIfAbsent = async (key, value) => { const result = await create(key, value); abort.abort(); return result; };
	assert.equal((await applyPhotoImportPresetV1(f.port, f.root, save(), { signal: abort.signal })).revision, 1);
	for (const committed of [false, true]) {
		const g = fixture(), failure = new Error('Lost preset acknowledgement'), write = g.port.putIfAbsent;
		g.port.putIfAbsent = async (key, value) => { if (committed) await write(key, value); throw failure; };
		const saving = applyPhotoImportPresetV1(g.port, g.root, save());
		if (committed) assert.equal((await saving).revision, 1);
		else await assert.rejects(saving, error => error === failure);
	}
});

test('required persisted and save-command settings cannot silently become plain import defaults', async () => {
	const f = fixture();
	assert.throws(() => normalizePhotoImportPresetCommandV1({ ...save(), settings: undefined }), /settings/iu);
	await f.repository.put(f.key, { schemaVersion: 1, kind: 'photo-import-presets', catalogId: 'catalog', revision: 1,
		presets: [{ id: 'preset', name: 'Preset', settings: undefined }] });
	await assert.rejects(readPhotoImportPresetsV1(f.port, 'catalog'), /settings/iu);
});

test('failed publication plus corrupt reconciliation preserves both errors and never replaces the row', async () => {
	const f = fixture(), failure = new Error('Write acknowledgement failed');
	f.port.putIfAbsent = async () => {
		await f.repository.put(f.key, { schemaVersion: 2 }); throw failure;
	};
	await assert.rejects(applyPhotoImportPresetV1(f.port, f.root, save()), (error: unknown) => {
		assert.ok(error instanceof AggregateError); assert.equal(error.errors[0], failure);
		assert.ok(error.errors[1] instanceof Error); return true;
	});
	assert.deepEqual(await f.repository.get(f.key), { schemaVersion: 2 });
});

test('full capacity allows replacement but refuses a seventeenth preset before CAS', async () => {
	const f = fixture();
	await f.repository.put(f.key, { schemaVersion: 1, kind: 'photo-import-presets', catalogId: 'catalog', revision: 16,
		presets: Array.from({ length: 16 }, (_, index) => ({ id: `preset-${index}`, name: `Preset ${index}`, settings: recipe })) });
	await assert.rejects(applyPhotoImportPresetV1(f.port, f.root, save(16, 'seventeenth')), /presets/iu);
	assert.equal(f.calls.includes('replace'), false);
	const updated = await applyPhotoImportPresetV1(f.port, f.root, { ...save(16, 'preset-7'), name: 'Replaced' });
	assert.equal(updated.revision, 17); assert.equal(updated.presets.length, 16);
	assert.equal(updated.presets.find(preset => preset.id === 'preset-7')?.name, 'Replaced');
});

test('CAS compares the exact stored row even when valid key, preset and metadata order is noncanonical', async () => {
	const f = fixture();
	const raw = { presets: [{ settings: { keywordIds: ['keyword'], metadata: { location: 'Here', title: 'Title' }, rename: null },
		name: 'Z', id: 'z' }, { name: 'A', id: 'a', settings: recipe }], revision: 4, catalogId: 'catalog', kind: 'photo-import-presets', schemaVersion: 1 };
	await f.repository.put(f.key, raw);
	const current = await readPhotoImportPresetsV1(f.port, 'catalog');
	assert.deepEqual(current.presets.map(preset => preset.id), ['a', 'z']);
	assert.equal((await applyPhotoImportPresetV1(f.port, f.root, { ...save(4, 'z'), name: 'Updated' })).revision, 5);
});

test('native abort and getter-bearing requests remain inert before storage and after a held read', async () => {
	const f = fixture(), abort = new AbortController(), result = deferred<unknown>();
	let invoked = 0;
	const shadow = Object.defineProperty(abort.signal, 'throwIfAborted', { get: () => { invoked++; return () => undefined; } });
	await assert.rejects(readPhotoImportPresetsV1(f.port, 'catalog', { signal: shadow }), /native/iu);
	const options = Object.defineProperty({}, 'signal', { enumerable: true, get: () => { invoked++; return abort.signal; } });
	await assert.rejects(readPhotoImportPresetsV1(f.port, 'catalog', options));
	assert.equal(invoked, 0); assert.equal(f.calls.length, 0);
	const lateAbort = new AbortController(); f.port.get = async () => result.promise;
	const reading = applyPhotoImportPresetV1(f.port, f.root, save(), { signal: lateAbort.signal });
	lateAbort.abort(); result.resolve(undefined);
	await assert.rejects(reading, { name: 'AbortError' }); assert.equal(f.calls.includes('create'), false);
});

test('lost acknowledgment never adopts a later winner and replacement acknowledgments survive late abort', async () => {
	const f = fixture(), failure = new Error('Lost acknowledgement'), write = f.port.putIfAbsent;
	f.port.putIfAbsent = async (key, value) => {
		await write(key, value);
		await f.repository.put(key, { schemaVersion: 1, kind: 'photo-import-presets', catalogId: 'catalog', revision: 2,
			presets: [{ id: 'winner', name: 'Later winner', settings: recipe }] });
		throw failure;
	};
	await assert.rejects(applyPhotoImportPresetV1(f.port, f.root, save()), error => error === failure);
	assert.equal((await readPhotoImportPresetsV1(f.port, 'catalog')).presets[0]?.id, 'winner');
	const abort = new AbortController(), replace = f.port.replaceIfCurrent;
	f.port.replaceIfCurrent = async (...args) => { const acknowledged = await replace(...args); abort.abort(); return acknowledged; };
	assert.equal((await applyPhotoImportPresetV1(f.port, f.root, save(2), { signal: abort.signal })).revision, 3);
});

test('same-revision corruption with a distinct lone surrogate refuses exact stored-row CAS', async () => {
	const f = fixture();
	await applyPhotoImportPresetV1(f.port, f.root, { ...save(), settings: { ...recipe, metadata: { title: '\ud800' } } });
	const replace = f.port.replaceIfCurrent;
	f.port.replaceIfCurrent = async (key, expected, replacement) => {
		const raw = normalizePhotoImportPresetRowV1(await f.repository.get(key), 'catalog');
		await f.repository.put(key, { ...raw, presets: raw.presets.map(preset => ({ ...preset,
			settings: { ...preset.settings, metadata: { title: '\ud801' } } })) });
		return replace(key, expected, replacement);
	};
	await assert.rejects(applyPhotoImportPresetV1(f.port, f.root, save(1)), { code: 'IMPORT_PRESET_REVISION_CONFLICT' });
	const stored = await readPhotoImportPresetsV1(f.port, 'catalog');
	assert.equal(stored.revision, 1); assert.equal(stored.presets[0]?.settings.metadata.title, '\ud801');
});

test('the existing media settings facade persists one CAS row through IndexedDB without inventory or original reads', async () => {
	const indexedDB = createInstrumentedIndexedDB(), databaseName = `lightscaper-import-presets-${crypto.randomUUID()}`;
	const options = { indexedDB: indexedDB as unknown as IDBFactory, locks: null, preferOpfs: false, databaseName };
	const first = new PhotoMediaStoreV1(options);
	try {
		assert.equal((await applyPhotoImportPresetV1(first.settingsRepository, queryCatalogRootV1(), save())).revision, 1);
		assert.equal(indexedDB.stats.cursorRequests.length, 0); assert.equal(indexedDB.stats.getAllRequests.length, 0);
	} finally { await first.close(); }
	const reopened = new PhotoMediaStoreV1(options);
	try {
		const stored = await readPhotoImportPresetsV1(reopened.settingsRepository, 'catalog');
		assert.equal(stored.revision, 1); assert.equal(stored.presets[0]?.id, 'preset');
		await assert.rejects(applyPhotoImportPresetV1(reopened.settingsRepository, queryCatalogRootV1(), save()), { code: 'IMPORT_PRESET_REVISION_CONFLICT' });
		assert.equal(indexedDB.stats.cursorRequests.length, 0); assert.equal(indexedDB.stats.getAllRequests.length, 0);
	} finally { await reopened.close(); }
});
