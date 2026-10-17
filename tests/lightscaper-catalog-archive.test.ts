/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ZipReader, BlobReader, ZipWriter, BlobWriter, Uint8ArrayWriter } from '@zip.js/zip.js/index-native.js';
import { exportPhotoCatalogArchiveV1 } from '../src/lightscaper/archive/catalog-archive-export.ts';
import { importPhotoCatalogArchiveV1, type PhotoCatalogArchiveStageV1 } from '../src/lightscaper/archive/catalog-archive-import.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { createPhotoVersionV1 } from '../src/lightscaper/catalog/photo-history.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import type { PhotoDocumentV1 } from '../src/lightscaper/catalog/types.ts';
import { importScapeProject, inspectScapeProject } from '../src/common/editor/scape-project.js';
import { copyFutureScapeArchive } from '../src/common/editor/scape-archive-copy.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { readScapeArchiveEnvelope } from '../src/common/editor/scape-archive-envelope.ts';
import { withScapeProjectInput } from '../src/common/editor/scape-project-input.ts';
import type { PhotoCatalogPackInput } from '../src/lightscaper/archive/catalog-pack.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

function root(photoCount = 2) {
	return normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1,
		kind: 'photo-catalog', id: 'catalog-1', name: 'Photo library', revision: 3,
		photoCount, folders: [], keywords: [], collections: [] });
}

function destination(failPublish = false) {
	const records = new Map<string, { photo: PhotoDocumentV1; bytes: Uint8Array }>();
	const events: string[] = [];
	const stage: PhotoCatalogArchiveStageV1 = {
		async writePhoto(photo, chunks) {
			assert.equal(records.has(photo.id), false);
			const parts: Uint8Array[] = [];
			for await (const part of chunks) parts.push(part.slice());
			const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
			let offset = 0;
			for (const part of parts) { bytes.set(part, offset); offset += part.length; }
			records.set(photo.id, { photo, bytes }); events.push('photo');
		},
		async publish() { events.push('publish'); if (failPublish) throw new Error('publication failed'); },
		async rollback() { events.push('rollback'); records.clear(); },
	};
	return { records, events, stage };
}

test('catalog Scape round trips exact originals and photo develop state through a provisional destination', async () => {
	const original = photoArchiveFixture(1);
	const version = original.photo.versions[0];
	const adjusted = normalizePhotoDocumentV1({ ...original.photo, versions: [{ ...version, develop: {
		...version.develop, effects: [createVideoEffect('color-adjust', { id: 'grade', params: { brightness: 0.2 } })],
		geometry: { crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 }, rotationDegrees: 30, flipHorizontal: true, flipVertical: false },
	} }] });
	const photo = createPhotoVersionV1(adjusted, { id: 'virtual-1', name: 'Warm', createdAt: '2026-10-07T00:00:00.000Z' });
	const fixtures = [{ ...original, photo }, photoArchiveFixture(2, new Uint8Array([4, 5, 6]))];
	const exported = await exportPhotoCatalogArchiveV1(root(), fixtures);
	assert.ok(exported.blob instanceof Blob);
	const target = destination();
	assert.deepEqual(await importPhotoCatalogArchiveV1(exported.blob, async () => target.stage), root());
	assert.deepEqual(target.events, ['photo', 'photo', 'publish']);
	for (const fixture of fixtures) {
		assert.deepEqual(target.records.get(fixture.photo.id), { photo: fixture.photo, bytes: new Uint8Array(await fixture.original.arrayBuffer()) });
	}
});

test('Framescaper classifies a catalog as foreign project state without authoring or current-store reads and preserves its complete archive', async () => {
	const exported = await exportPhotoCatalogArchiveV1(root(1), [photoArchiveFixture()]);
	assert.ok(exported.blob);
	const options = { currentProjectSchemaFamily: 'framescaper' as const,
		loadProject: () => { assert.fail('A photo catalog must not reach the timeline domain.'); } };
	const store = { loadProject: () => { assert.fail('Foreign IDs must not reach the current project store.'); } };
	const inspected = await inspectScapeProject(exported.blob, store, options);
	assert.equal(inspected.readOnly, true); assert.equal(inspected.reason, 'foreign-family');
	assert.equal(inspected.schemaFamily, 'lightscaper'); assert.equal(inspected.title, root(1).name);
	const opened = await importScapeProject(exported.blob, store, options);
	assert.equal(opened.readOnly, true); assert.deepEqual(opened.project, exported.document);
	const parts: Uint8Array[] = [];
	await copyFutureScapeArchive(exported.blob, (bytes) => { parts.push(bytes.slice()); }, options);
	assert.deepEqual(new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer()), new Uint8Array(await exported.blob.arrayBuffer()));
});

test('empty catalogs and streaming export use the same Scape schema and bounded destination', async () => {
	const parts: Uint8Array[] = [];
	const writable = new WritableStream<Uint8Array>({ write(bytes) { parts.push(bytes.slice()); } });
	const exported = await exportPhotoCatalogArchiveV1(root(0), [], { writable });
	assert.equal(exported.blob, null); assert.equal(exported.manifest.assets.length, 0);
	const target = destination();
	assert.deepEqual(await importPhotoCatalogArchiveV1(new Blob(parts as BlobPart[]), async () => target.stage), root(0));
	assert.deepEqual(target.events, ['publish']);
});

test('a catalog larger than one pack retains every original and publishes only after both packs drain', async () => {
	const fixtures = Array.from({ length: 4_097 }, (_, index) => photoArchiveFixture(index + 1));
	const exported = await exportPhotoCatalogArchiveV1(root(fixtures.length), fixtures);
	assert.ok(exported.blob);
	assert.deepEqual(exported.document.packs.map((pack) => pack.photoCount), [4_096, 1]);
	const target = destination();
	await importPhotoCatalogArchiveV1(exported.blob, async () => target.stage);
	assert.equal(target.records.size, fixtures.length);
	assert.equal(target.events.filter((event) => event === 'publish').length, 1);
	assert.equal(target.events.at(-1), 'publish');
	assert.deepEqual(target.records.get('photo-4097'), { photo: fixtures[4_096].photo, bytes: new Uint8Array([1, 2, 3]) });
});

test('a duplicate appearing in the second pack aborts export and closes the source', async () => {
	let closed = false;
	async function* source() {
		try {
			for (let index = 1; index <= 4_097; index += 1) yield photoArchiveFixture(index);
			yield photoArchiveFixture(1);
		} finally { closed = true; }
	}
	let aborted = false;
	const writable = new WritableStream<Uint8Array>({ write() {}, abort() { aborted = true; } });
	await assert.rejects(exportPhotoCatalogArchiveV1(root(4_098), source(), { writable }), (error: unknown) => hasFailure(error, /duplicate/iu));
	assert.equal(closed, true); assert.equal(aborted, true);
});

test('the photo pack asset kind cannot be assigned to a timeline family even by an extension', async () => {
	const exported = await exportPhotoCatalogArchiveV1(root(1), [photoArchiveFixture()]);
	assert.ok(exported.blob);
	const project = new TextEncoder().encode(JSON.stringify({ ...exported.document, schemaFamily: 'framescaper' }));
	const manifest = new TextEncoder().encode(JSON.stringify({ ...exported.manifest, project: {
		...exported.manifest.project, schemaFamily: 'framescaper', size: project.byteLength, sha256: digestScapeBytes(project),
	} }));
	const disguised = await rewrite(exported.blob, (name, bytes) => name === 'project.json' ? project : name === 'manifest.json' ? manifest : bytes);
	await assert.rejects(inspectScapeProject(disguised, {}, { currentProjectSchemaFamily: 'framescaper' }), /invalid kind/iu);
	await assert.rejects(withScapeProjectInput(disguised, undefined, (entries) => readScapeArchiveEnvelope(entries, {}, undefined,
		['photo-catalog-pack'])), /registered project family/iu);
});

test('missing catalog definitions refuse export', async () => {
	const fixture = photoArchiveFixture();
	const photo = normalizePhotoDocumentV1({ ...fixture.photo, folderId: 'missing-folder' });
	await assert.rejects(exportPhotoCatalogArchiveV1(root(1), [{ ...fixture, photo }]), (error: unknown) => hasFailure(error, /missing catalog definition/iu));
});

test('inconsistent catalog counts, cross-pack duplicate identities and excessive Blob output abort export', async () => {
	await assert.rejects(exportPhotoCatalogArchiveV1(root(2), [photoArchiveFixture()]), (error: unknown) => hasFailure(error, /count/iu));
	await assert.rejects(exportPhotoCatalogArchiveV1(root(2), [photoArchiveFixture(), photoArchiveFixture()]), (error: unknown) => hasFailure(error, /duplicate/iu));
	await assert.rejects(exportPhotoCatalogArchiveV1(root(1), [photoArchiveFixture()], { maximumBlobBytes: 64 }), (error: unknown) => hasFailure(error, /maximum/iu));
});

test('throwing sync and async iterator factories abort and unlock the external archive destination', async () => {
	const failure = new Error('iterator factory failed');
	const sources: (Iterable<PhotoCatalogPackInput> | AsyncIterable<PhotoCatalogPackInput>)[] = [
		{ [Symbol.iterator]() { throw failure; } }, { [Symbol.asyncIterator]() { throw failure; } },
	];
	for (const source of sources) {
		let aborted: unknown;
		const writable = new WritableStream<Uint8Array>({ write() {}, abort(reason: unknown) { aborted = reason; } });
		await assert.rejects(exportPhotoCatalogArchiveV1(root(0), source, { writable }), (error: unknown) => hasFailure(error, /iterator factory failed/iu));
		assert.equal(aborted, failure);
		assert.equal(writable.locked, false);
	}
});

test('corrupt packs and failed publication roll back staged rows instead of publishing an incomplete catalog', async () => {
	const exported = await exportPhotoCatalogArchiveV1(root(1), [photoArchiveFixture()]);
	assert.ok(exported.blob);
	const corrupt = await rewrite(exported.blob, (name, bytes) => {
		if (name.startsWith('assets/')) { const changed = bytes.slice(); changed[changed.length - 1] ^= 1; return changed; }
		return bytes;
	});
	const target = destination();
	await assert.rejects(importPhotoCatalogArchiveV1(corrupt, async () => target.stage), (error: unknown) => hasFailure(error, /digest|SHA-256/iu));
	assert.equal(target.events.includes('publish'), false); assert.equal(target.events.at(-1), 'rollback');
	assert.equal(target.records.size, 0);
	const failed = destination(true);
	await assert.rejects(importPhotoCatalogArchiveV1(exported.blob, async () => failed.stage), /publication failed/iu);
	assert.deepEqual(failed.events, ['photo', 'publish', 'rollback']);
});

test('future catalog schemas fail before acquiring a publication stage', async () => {
	const exported = await exportPhotoCatalogArchiveV1(root(0), []);
	assert.ok(exported.blob);
	const projectBytes = new TextEncoder().encode(JSON.stringify({ ...exported.document, schemaVersion: 2 }));
	const manifestBytes = new TextEncoder().encode(JSON.stringify({ ...exported.manifest, project: {
		...exported.manifest.project, schemaVersion: 2, size: projectBytes.byteLength, sha256: digestScapeBytes(projectBytes),
	} }));
	const future = await rewrite(exported.blob, (name, bytes) => {
		if (name === 'project.json') return projectBytes;
		if (name === 'manifest.json') return manifestBytes;
		return bytes;
	});
	await assert.rejects(importPhotoCatalogArchiveV1(future, async () => { assert.fail('Future state cannot acquire a stage.'); }), /schema/iu);
});

test('canceling after an original is staged prevents publication and rolls the stage back', async () => {
	const exported = await exportPhotoCatalogArchiveV1(root(1), [photoArchiveFixture()]);
	assert.ok(exported.blob);
	const target = destination();
	const stop = new AbortController();
	const stage: PhotoCatalogArchiveStageV1 = { ...target.stage,
		async writePhoto(photo, bytes) { await target.stage.writePhoto(photo, bytes); stop.abort(); },
	};
	await assert.rejects(importPhotoCatalogArchiveV1(exported.blob, async () => stage, { signal: stop.signal }), { name: 'AbortError' });
	assert.deepEqual(target.events, ['photo', 'rollback']);
	assert.equal(target.records.size, 0);
});

test('archive reader cleanup completes before publication and cleanup failure rolls back a fully staged catalog', async () => {
	const exported = await exportPhotoCatalogArchiveV1(root(1), [photoArchiveFixture()]);
	assert.ok(exported.blob);
	const target = destination();
	const cleanup = new Error('reader close failed');
	await assert.rejects(importPhotoCatalogArchiveV1(exported.blob, async () => target.stage, {
		readerFactories: { blob: (blob) => {
			const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
			return {
				async *getEntriesGenerator() {
					for (const entry of await reader.getEntries()) {
						if (entry.directory) throw new Error('Unexpected directory in fixture.');
						yield { filename: entry.filename, directory: false, encrypted: entry.encrypted,
							compressionMethod: entry.compressionMethod, compressedSize: entry.compressedSize, uncompressedSize: entry.uncompressedSize,
							async getData(writable, options) {
								if (options?.checkOverlappingEntryOnly) return;
								return entry.getData(writable, { signal: options?.signal });
							} };
					}
					return true;
				},
				async close() { await reader.close(); target.events.push('reader-close'); throw cleanup; },
			};
		} },
	}), (error: unknown) => error === cleanup);
	assert.deepEqual(target.events, ['photo', 'reader-close', 'rollback']);
	assert.equal(target.records.size, 0);
});

async function rewrite(blob: Blob, mutate: (name: string, bytes: Uint8Array) => Uint8Array): Promise<Blob> {
	const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
	const writer = new ZipWriter(new BlobWriter(), { level: 0, zip64: true, useWebWorkers: false });
	try {
		for (const entry of await reader.getEntries()) {
			if (entry.directory) throw new Error('The fixture requires only file entries.');
			assert.ok(entry.getData);
			const bytes = await entry.getData(new Uint8ArrayWriter());
			const altered = mutate(entry.filename, bytes);
			await writer.add(entry.filename, new BlobReader(new Blob([altered as BlobPart])));
		}
		return await writer.close();
	} finally { await reader.close(); }
}

function hasFailure(error: unknown, pattern: RegExp): boolean {
	if (error instanceof AggregateError) return error.errors.some((cause: unknown) => hasFailure(cause, pattern));
	return error instanceof Error && pattern.test(error.message);
}
