/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ZipReader, BlobReader } from '@zip.js/zip.js/index-native.js';
import { exportPhotoCatalogArchiveV2 } from '../src/lightscaper/archive/catalog-archive-export-v2.ts';
import { importPhotoCatalogArchiveV2 } from '../src/lightscaper/archive/catalog-archive-import-v2.ts';
import { normalizePhotoCatalogArchiveV2 } from '../src/lightscaper/archive/catalog-archive-contract-v2.ts';
import { exportPhotoCatalogArchiveV1 } from '../src/lightscaper/archive/catalog-archive-export.ts';
import { importPhotoCatalogArchiveV1 } from '../src/lightscaper/archive/catalog-archive-import.ts';
import { PhotoCatalogArchiveIdentityLedger } from '../src/lightscaper/archive/catalog-archive-identities.ts';
import { inspectScapeProject, importScapeProject } from '../src/common/editor/scape-project.js';
import { copyFutureScapeArchive } from '../src/common/editor/scape-archive-copy.ts';
import { withScapeProjectInput } from '../src/common/editor/scape-project-input.ts';
import { readScapeArchiveEnvelope } from '../src/common/editor/scape-archive-envelope.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { stackArchiveRoot as root, stackArchiveRecord as stack, stackArchiveDestination as destination,
	rewriteStackArchive as rewrite, editStackArchiveDocument as editDocument, stackArchiveFailure as hasFailure } from './helpers/lightscaper-stack-archive-fixture.ts';
import { replaceStackArchivePack } from './helpers/lightscaper-stack-archive-fixture.ts';

const photos = (count = 4) => Array.from({ length: count }, (_, index) => photoArchiveFixture(index + 1));

test('explicit archive2 streams unchanged photo1 and stack1 then closes readers before one publication', async () => {
	const grouping = [stack(), stack('stack-2', ['photo-4', 'photo-3'])], source = photos();
	const exported = await exportPhotoCatalogArchiveV2(root(), source, grouping); assert.ok(exported.blob);
	assert.equal(exported.document.schemaVersion, 2); assert.equal(exported.document.catalog.schemaVersion, 1);
	assert.equal(exported.manifest.formatVersion, 1); assert.equal(exported.manifest.project.schemaVersion, 2);
	assert.equal(exported.document.stackCount, 2); assert.deepEqual(exported.document.stackPacks.map(pack => pack.stackCount), [2]);
	const target = destination();
	assert.deepEqual(await importPhotoCatalogArchiveV2(exported.blob, async () => target.stage), root());
	assert.deepEqual([...target.stacks.values()], grouping); assert.equal(target.events.at(-1), 'publish');
	assert.deepEqual(target.events.slice(0, 4), source.map(record => `photo:${record.photo.id}`));
	for (const record of source) assert.deepEqual(target.photos.get(record.photo.id), { photo: record.photo, bytes: new Uint8Array(await record.original.arrayBuffer()) });
	await assert.rejects(importPhotoCatalogArchiveV1(exported.blob, async () => { assert.fail('V1 must refuse before staging.'); }), /schema|unsupported field/iu);
});

test('archive2 importer admits old v1 as an empty-stack catalog; v1 photo pack bytes stay exact', async () => {
	const old = await exportPhotoCatalogArchiveV1(root(), photos()), current = await exportPhotoCatalogArchiveV2(root(), photos(), []);
	assert.ok(old.blob); assert.ok(current.blob);
	const target = destination(); await importPhotoCatalogArchiveV2(old.blob, async () => target.stage);
	assert.equal(target.photos.size, 4); assert.equal(target.stacks.size, 0); assert.equal(target.events.at(-1), 'publish');
	const extracted = async (blob: Blob) => { let result: Uint8Array | undefined; await rewrite(blob, entries => { result = entries.get('assets/photo-pack-000001.bin'); }); return result; };
	assert.deepEqual(await extracted(old.blob), await extracted(current.blob));
});

test('foreign timeline products hold complete archive2 opaquely without granting photo authoring', async () => {
	const exported = await exportPhotoCatalogArchiveV2(root(), photos(), [stack()]); assert.ok(exported.blob);
	for (const currentProjectSchemaFamily of ['soundscaper', 'framescaper'] as const) {
		const options = { currentProjectSchemaFamily, loadProject() { assert.fail('No timeline domain admission.'); } };
		const inspected = await inspectScapeProject(exported.blob, {}, options); assert.equal(inspected.readOnly, true);
		assert.equal(inspected.reason, 'foreign-family'); assert.equal(inspected.schemaVersion, 2);
		const opened = await importScapeProject(exported.blob, {}, options); assert.deepEqual(opened.project, exported.document);
		const parts: Uint8Array[] = []; await copyFutureScapeArchive(exported.blob, part => { parts.push(new Uint8Array(part)); }, options);
		assert.deepEqual(new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer()), new Uint8Array(await exported.blob.arrayBuffer()));
	}
});

test('missing/foreign/duplicate member assignments reject export and close the stack iterator', async () => {
	for (const grouping of [[stack('one', ['photo-1', 'missing'])], [stack(), stack('other', ['photo-2', 'photo-3'])],
		[{ ...stack(), catalogId: 'catalog-2' }], [stack(), stack()]]) {
		let closed = false, aborted = false;
		async function* records() { try { yield* grouping; } finally { closed = true; } }
		const writable = new WritableStream<Uint8Array>({ write() {}, abort() { aborted = true; } });
		await assert.rejects(exportPhotoCatalogArchiveV2(root(), photos(), records(), { writable }), error => hasFailure(error, /member|catalog|duplicate|assigned/iu));
		assert.equal(closed, true); assert.equal(aborted, true); assert.equal(writable.locked, false);
	}
});

test('stack sequence splits at1024 records without retaining a whole-catalog document', async () => {
	const count = 1_025, records = Array.from({ length: count }, (_, index) => stack(`stack-${index}`, [`photo-${index * 2 + 1}`, `photo-${index * 2 + 2}`]));
	const exported = await exportPhotoCatalogArchiveV2(root(count * 2), photos(count * 2), records); assert.ok(exported.blob);
	assert.deepEqual(exported.document.stackPacks.map(pack => pack.stackCount), [1_024, 1]);
	const target = destination(); await importPhotoCatalogArchiveV2(exported.blob, async () => target.stage);
	assert.equal(target.stacks.size, count); assert.equal(target.events.filter(event => event === 'publish').length, 1);
});

test('closed archive2 descriptors enforce combined asset count and exact stack counts', () => {
	const document = { schemaFamily: 'lightscaper', schemaVersion: 2, kind: 'photo-catalog-archive', id: root(0).id, title: root(0).name,
		catalog: root(0), packs: [], stackCount: 0, stackPacks: [] };
	assert.deepEqual(normalizePhotoCatalogArchiveV2(document), document);
	assert.throws(() => normalizePhotoCatalogArchiveV2({ ...document, stackCount: 1 }), /count/iu);
	assert.throws(() => normalizePhotoCatalogArchiveV2({ ...document, unknown: true }), /unsupported field/iu);
	const packs = Array.from({ length: 4_093 }, (_, index) => ({ id: `stack-pack-${index}`, entry: `assets/stack-pack-${String(index + 1).padStart(6, '0')}.bin`, stackCount: 1 }));
	const photoPacks = [1, 2].map(index => ({ id: `photo-pack-${index}`, entry: `assets/photo-pack-${String(index).padStart(6, '0')}.bin`, photoCount: 4_095 }));
	assert.throws(() => normalizePhotoCatalogArchiveV2({ ...document, catalog: root(8_190), packs: photoPacks, stackCount: packs.length, stackPacks: packs }), /pack|asset/iu);
});

test('a combined bounded identity ledger refuses exhaustion and exclusive reassignment before mutation', () => {
	const ledger = new PhotoCatalogArchiveIdentityLedger(20); ledger.admitPhoto('photo-1'); ledger.admitPhoto('photo-2');
	assert.equal(ledger.photoCount, 2); ledger.admitStack('one', ['photo-1', 'photo-2']);
	assert.throws(() => ledger.admitStack('two', ['photo-1', 'photo-2']), /assigned/iu);
	assert.throws(() => ledger.admitPhoto('photo-3'), /identity/iu); assert.equal(ledger.photoCount, 2);
	assert.throws(() => new PhotoCatalogArchiveIdentityLedger(16 * 1024 * 1024 + 1), /tighten/iu);
});

test('tampered/truncated stack bodies and corrupt counts roll back all photos and never publish', async () => {
	const exported = await exportPhotoCatalogArchiveV2(root(), photos(), [stack()]); assert.ok(exported.blob);
	const mutations = [
		(entries: Map<string, Uint8Array>) => { const bytes = entries.get('assets/stack-pack-000001.bin')!.slice(); bytes[bytes.length - 1] ^= 1; entries.set('assets/stack-pack-000001.bin', bytes); },
		(entries: Map<string, Uint8Array>) => { const bytes = entries.get('assets/stack-pack-000001.bin')!; entries.set('assets/stack-pack-000001.bin', bytes.subarray(0, bytes.length - 1)); },
		(entries: Map<string, Uint8Array>) => { editDocument(entries, document => { document.stackCount = 2; (document.stackPacks as { stackCount: number }[])[0].stackCount = 2; }); },
	];
	for (const mutation of mutations) { const target = destination();
		await assert.rejects(importPhotoCatalogArchiveV2(await rewrite(exported.blob, mutation), async () => target.stage));
		assert.equal(target.events.includes('publish'), false); assert.equal(target.photos.size, 0); assert.equal(target.stacks.size, 0);
		if (target.events.length > 0) assert.equal(target.events.at(-1), 'rollback');
	}
});

test('post-staging cancellation, staging failure and rollback failure remain joined and truthful', async () => {
	const exported = await exportPhotoCatalogArchiveV2(root(), photos(), [stack()]); assert.ok(exported.blob);
	const target = destination(), stop = new AbortController();
	await assert.rejects(importPhotoCatalogArchiveV2(exported.blob, async () => ({ ...target.stage,
		async writeStack(value) { await target.stage.writeStack(value); stop.abort(); },
	}), { signal: stop.signal }), { name: 'AbortError' });
	assert.equal(target.events.at(-1), 'rollback'); assert.equal(target.photos.size, 0);
	const failure = new Error('stack stage failed'), rollback = new Error('rollback failed');
	await assert.rejects(importPhotoCatalogArchiveV2(exported.blob, async () => ({ ...destination().stage,
		async writeStack() { throw failure; }, async rollback() { throw rollback; },
	})), error => hasFailure(error, /stack stage failed/iu) && hasFailure(error, /rollback failed/iu));
});

test('authenticated missing, foreign and multiply assigned stack members refuse after photos stage', async () => {
	const exported = await exportPhotoCatalogArchiveV2(root(), photos(), [stack()]); assert.ok(exported.blob);
	for (const records of [[stack('missing', ['photo-1', 'missing'])], [{ ...stack(), catalogId: 'catalog-2' }],
		[stack(), stack('other', ['photo-2', 'photo-3'])]]) {
		const corrupt = await rewrite(exported.blob, async entries => {
			await replaceStackArchivePack(entries, records);
			editDocument(entries, document => { document.stackCount = records.length; (document.stackPacks as { stackCount: number }[])[0].stackCount = records.length; });
		});
		const target = destination();
		await assert.rejects(importPhotoCatalogArchiveV2(corrupt, async () => target.stage), error => hasFailure(error, /missing|catalog|assigned/iu));
		assert.equal(target.events.filter(event => event.startsWith('photo:')).length, 4);
		assert.equal(target.events.includes('publish'), false); assert.equal(target.events.at(-1), 'rollback'); assert.equal(target.photos.size, 0);
	}
});

test('valid closed stack tampering fails the manifest digest after provisional writes', async () => {
	const exported = await exportPhotoCatalogArchiveV2(root(), photos(), [stack()]); assert.ok(exported.blob);
	const corrupt = await rewrite(exported.blob, entries => {
		const entry = 'assets/stack-pack-000001.bin', body = entries.get(entry)!;
		const text = new TextDecoder().decode(body.subarray(12)).replace('"revision":3', '"revision":4');
		const changed = body.slice(); changed.set(new TextEncoder().encode(text), 12); entries.set(entry, changed);
	});
	const target = destination(); await assert.rejects(importPhotoCatalogArchiveV2(corrupt, async () => target.stage), error => hasFailure(error, /SHA-256|digest/iu));
	assert.ok(target.events.includes('stack:stack-1')); assert.equal(target.events.at(-1), 'rollback'); assert.equal(target.stacks.size, 0);
});

test('streaming destination bounds and stack enumeration cleanup never acknowledge failed output', async () => {
	let closed = false, aborted = false; const enumeration = new Error('stack iteration failed'), cleanup = new Error('stack return failed');
	let read = false;
	const records = { [Symbol.asyncIterator]() { return {
		async next() { if (read) throw enumeration; read = true; return { done: false as const, value: stack() }; },
		async return() { closed = true; throw cleanup; },
	}; } };
	const writable = new WritableStream<Uint8Array>({ write() {}, abort() { aborted = true; } });
	await assert.rejects(exportPhotoCatalogArchiveV2(root(), photos(), records, { writable }), error => hasFailure(error, /stack return failed/iu) && hasFailure(error, /stack iteration failed/iu));
	assert.equal(closed, true); assert.equal(aborted, true); assert.equal(writable.locked, false);
	await assert.rejects(exportPhotoCatalogArchiveV2(root(), photos(), [stack()], { maximumBlobBytes: 64 }), error => hasFailure(error, /maximum/iu));
});

test('reader cleanup failure prevents publication after all stacks stage', async () => {
	const exported = await exportPhotoCatalogArchiveV2(root(), photos(), [stack()]); assert.ok(exported.blob);
	const target = destination(), failure = new Error('reader close failed');
	await assert.rejects(importPhotoCatalogArchiveV2(exported.blob, async () => target.stage, { readerFactories: { blob(blob) {
		const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
		return { async *getEntriesGenerator() { for (const entry of await reader.getEntries()) { if (entry.directory) continue;
			yield { filename: entry.filename, directory: false, encrypted: entry.encrypted, compressionMethod: entry.compressionMethod,
				compressedSize: entry.compressedSize, uncompressedSize: entry.uncompressedSize,
				async getData(writable, options) { if (options?.checkOverlappingEntryOnly) return; return entry.getData(writable, { signal: options?.signal }); } };
		} return true; }, async close() { await reader.close(); throw failure; } };
	} } }), /reader close failed/iu);
	assert.ok(target.events.includes('stack:stack-1')); assert.equal(target.events.at(-1), 'rollback'); assert.equal(target.events.includes('publish'), false);
});

test('stack pack kind cannot be injected into a timeline family through extension admission', async () => {
	const exported = await exportPhotoCatalogArchiveV2(root(), photos(), [stack()]); assert.ok(exported.blob);
	const disguised = await rewrite(exported.blob, entries => {
		editDocument(entries, document => { document.schemaFamily = 'framescaper'; });
		const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json'))) as { project: { schemaFamily: string } };
		manifest.project.schemaFamily = 'framescaper'; entries.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
	});
	await assert.rejects(withScapeProjectInput(disguised, undefined, entries => readScapeArchiveEnvelope(entries, {}, undefined,
		['photo-catalog-pack', 'photo-stack-pack'])), /registered project family/iu);
});

test('a held successful native ZIP reader close prevents publication until cleanup acknowledges', async () => {
	const exported = await exportPhotoCatalogArchiveV2(root(), photos(), [stack()]); assert.ok(exported.blob);
	const target = destination(); let release!: () => void, closing!: () => void, closed = false;
	const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { closing = resolve; });
	const operation = importPhotoCatalogArchiveV2(exported.blob, async () => ({ ...target.stage,
		async publish() { assert.equal(closed, true); await target.stage.publish(); },
	}), { readerFactories: { blob(blob) {
		const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
		return { async *getEntriesGenerator() { for (const entry of await reader.getEntries()) { if (entry.directory) continue;
			yield { filename: entry.filename, directory: false, encrypted: entry.encrypted, compressionMethod: entry.compressionMethod,
				compressedSize: entry.compressedSize, uncompressedSize: entry.uncompressedSize,
				async getData(writable, options) { if (options?.checkOverlappingEntryOnly) return; return entry.getData(writable, { signal: options?.signal }); } };
		} return true; }, async close() { await reader.close(); closing(); await held; closed = true; } };
	} } });
	await started; assert.ok(target.events.includes('stack:stack-1')); assert.equal(target.events.includes('publish'), false);
	release(); assert.deepEqual(await operation, root()); assert.equal(target.events.at(-1), 'publish');
});

test('corrupt manifest pack metadata and archive3 refuse before destination acquisition', async () => {
	const exported = await exportPhotoCatalogArchiveV2(root(), photos(), [stack()]); assert.ok(exported.blob);
	for (const field of ['encoding', 'kind', 'schemaVersion'] as const) {
		const corrupt = await rewrite(exported.blob, entries => {
			if (field === 'schemaVersion') { editDocument(entries, document => { document.schemaVersion = 3; }); return; }
			const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json'))) as { assets: { kind: string; encoding: string }[] };
			const asset = manifest.assets.find(asset => asset.kind === 'photo-stack-pack')!; asset[field] = field === 'encoding' ? 'unsupported' : 'audio';
			entries.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
		});
		await assert.rejects(importPhotoCatalogArchiveV2(corrupt, async () => { assert.fail('Invalid archive cannot acquire a stage.'); }), /schema|descriptor/iu);
	}
});
