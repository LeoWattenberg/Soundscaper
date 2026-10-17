/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { normalizeImageDevelopStateV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createImageDevelopHandoffProvenanceCurrentV1 } from '../src/common/editor/image-develop-handoff-provenance-current-v1.ts';
import { normalizeFramescaperImageSourceCurrentV1 } from '../src/common/editor/timeline-image-model-current-v1.ts';
import { framescaperImagePackSourceCurrentV1 } from '../src/common/editor/timeline-image-pack-source-current-v1.ts';
import { prepareFramescaperRawImageOriginalCurrentV1 } from '../src/common/editor/timeline-image-raw-original-plan-current-v1.ts';
import { withFramescaperRawImageOriginalCurrentV1 } from '../src/common/editor/timeline-image-raw-pack-current-v1.ts';
import { validateFramescaperRawImageAssetBodyCurrentV1 } from '../src/framescaper/editor-scape-asset-plan-timeline-image-current.ts';
import { createPhotoImageHandoffSourceCurrentV1 } from '../src/lightscaper/controller/photo-image-handoff-source-current-v1.ts';
import { createPhotoFramescaperHandoffPhotoCurrentV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-photo-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { createPhotoExportSidecarCurrentV1, serializePhotoExportSidecarCurrentV1 } from '../src/lightscaper/catalog/photo-export-sidecar-current-v1.ts';
import { createPhotoCatalogArchiveReachabilityCurrentV1 } from '../src/lightscaper/archive/catalog-archive-reachability-current-v1.ts';
import { rawDerivedFrameFixtureCurrentV1 } from './helpers/lightscaper-raw-derived-frame-current-fixture.ts';
import { queryPhotoV1, queryCatalogRootV1 } from './helpers/lightscaper-catalog-query-fixture.ts';

const TIME = '2026-10-20T00:00:00.000Z';
function recipe() {
	return normalizeImageDevelopStateV4({ ...defaultImageDevelopStateV2(), processVersion: 4,
		rawDevelopment: { schemaVersion: 1, mode: 'recovery' }, repairs: { schemaVersion: 1, spots: [
			{ id: 'retained-clone', mode: 'clone', enabled: false, target: { x: .5, y: .5 }, source: { x: .25, y: .5 },
				radius: .1, feather: .5, opacity: 1 }] } });
}
type Fixture = Awaited<ReturnType<typeof rawDerivedFrameFixtureCurrentV1>>;
function source(f: Fixture) {
	const develop = recipe(), provenance = createImageDevelopHandoffProvenanceCurrentV1({ develop,
		original: f.source.provenance.original, origin: f.source.provenance.origin });
	const selected = normalizeFramescaperImageSourceCurrentV1({ ...f.source, develop, provenance });
	if (selected.schemaVersion !== 4) return assert.fail('The native RAW fixture must remain Source4.');
	return selected;
}
function photo(f: Fixture) {
	const template = queryPhotoV1();
	return normalizePhotoDocumentCurrentV1({ ...template, schemaVersion: 3, original: { ...template.original,
		name: 'Recovery.dng', mimeType: 'image/x-adobe-dng', width: f.canonical.descriptor.width, height: f.canonical.descriptor.height,
		contentSha256: f.pack.originalSha256, byteLength: f.original.length, hasAlpha: false },
		versions: template.versions.map(version => ({ ...version, develop: recipe() })) });
}

test('Current canonical Frame RAW proof admits a saved recovery recipe4 while lending exact ABI1 words and retiring both physical borrows', async () => {
	const f = await rawDerivedFrameFixtureCurrentV1(6), selected = source(f), before = f.pack.bytes.slice();
	let originalBacking: ArrayBuffer | undefined, wordsBacking: ArrayBuffer | undefined;
	try {
		const prepared = prepareFramescaperRawImageOriginalCurrentV1(selected);
		assert.deepEqual(prepared.source.develop, recipe()); assert.equal(prepared.frameBytes, f.canonical.words.length * 2);
		const decoder = f.ports.withRawOriginal!;
		await withFramescaperRawImageOriginalCurrentV1({ source: selected,
			read: (offset, length) => f.pack.bytes.subarray(offset, offset + length) }, view => {
			assert.equal(f.native.canonical.active(), 0); assert.equal(f.native.recovery.active(), 0);
			assert.deepEqual(Array.from(view.frame.pixels), f.canonical.words); assert.equal(view.rawFlip, f.raw.rawFlip);
			assert.deepEqual(view.originalBytes, f.original); originalBacking = view.originalBytes.buffer; wordsBacking = view.frame.pixels.buffer;
		}, { withRawOriginal: (request, consume) => Reflect.apply(decoder, f.ports, [request, consume]) });
		assert.ok(originalBacking); assert.ok(wordsBacking);
		assert.ok(new Uint8Array(originalBacking).every(value => value === 0)); assert.ok(new Uint8Array(wordsBacking).every(value => value === 0));
		assert.equal(f.native.events.includes('recovery-start'), false, 'Canonical proof never substitutes ABI2 for the immutable word receipt.');
		assert.deepEqual(f.pack.bytes, before); assert.deepEqual(selected.develop, recipe());
	} finally { await f.close(); }
});

test('Current editable Photo4-recipe handoff and reverse composition keep the exact raw pack, Original and source-processing setting', async () => {
	const f = await rawDerivedFrameFixtureCurrentV1(), input = photo(f), before = structuredClone(input);
	try {
		const binding = { catalogId: input.catalogId, photoId: input.id, versionId: input.activeVersionId, expectedRevision: input.revision };
		const factsJson = serializePhotoExportSidecarCurrentV1(createPhotoExportSidecarCurrentV1(input, binding));
		const result = await createPhotoImageHandoffSourceCurrentV1({ sourceId: 'saved-recovery', factsJson, raw: f.raw,
			original: { mimeType: input.original.mimeType!, width: input.original.width, height: input.original.height, hasAlpha: false }, pack: f.pack });
		assert.equal(result.source.schemaVersion, 4); if (result.source.schemaVersion !== 4) assert.fail('The RAW handoff remains Source4.');
		assert.deepEqual(result.source.develop, recipe()); assert.deepEqual(result.source.raw, f.raw);
		assert.deepEqual(new Uint8Array(await result.body.arrayBuffer()), f.pack.bytes);
		assert.equal(result.source.conversionReceiptSha256, f.pack.conversionReceiptSha256);
		const reopened = createPhotoFramescaperHandoffPhotoCurrentV1({ source: result.source, catalog: queryCatalogRootV1(),
			ownership: { photoId: 'received-recovery', originalId: 'received-original', storageKey: 'received-storage', masterVersionId: 'received-master' },
			createdAt: TIME, metadata: input.metadata, extractedMetadata: input.extractedMetadata });
		assert.equal(reopened.schemaVersion, 3); assert.deepEqual(reopened.versions[0]!.develop, recipe());
		assert.equal(reopened.original.contentSha256, input.original.contentSha256); assert.equal(reopened.original.byteLength, input.original.byteLength);
		assert.equal(reopened.original.name, input.original.name); assert.deepEqual(input, before);
	} finally { await f.close(); }
});

// The public archive validator keeps its real default decoder and production
// worker. Only external asset fetch and browser Worker transport are adapted.
async function withCanonicalTransport<Result>(f: Fixture, run: () => Promise<Result>): Promise<Result> {
	const worker = Object.getOwnPropertyDescriptor(globalThis, 'Worker'), fetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
	Object.defineProperty(globalThis, 'Worker', { configurable: true, value: function () { return f.native.canonical.createWorker(); } });
	Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url: unknown) => {
		assert.equal(url, 'https://assets.soundscaper.org/runtime/libraw/0.22.2/libraw.wasm');
		return new Response(new Uint8Array(await readFile(new URL('../runtime-assets/libraw/0.22.2/libraw.wasm', import.meta.url))),
			{ headers: { 'Content-Type': 'application/wasm' } });
	} });
	try { return await run(); }
	finally {
		if (worker) Object.defineProperty(globalThis, 'Worker', worker); else Reflect.deleteProperty(globalThis, 'Worker');
		if (fetch) Object.defineProperty(globalThis, 'fetch', fetch); else Reflect.deleteProperty(globalThis, 'fetch');
	}
}

test('Current archive body proof authenticates canonical RAW bytes beside recipe4 without deriving or changing its pack', async () => {
	const f = await rawDerivedFrameFixtureCurrentV1(), selected = source(f), before = f.pack.bytes.slice();
	try {
		const original = new Uint8Array(f.pack.bytes);
		await withCanonicalTransport(f, () => validateFramescaperRawImageAssetBodyCurrentV1(selected,
			new Blob([original.buffer], { type: selected.mimeType })));
		assert.equal(f.native.canonical.active(), 0); assert.equal(f.native.recovery.active(), 0);
		assert.deepEqual(framescaperImagePackSourceCurrentV1(selected), f.binding.pack); assert.deepEqual(f.pack.bytes, before);
		const corrupted = new Uint8Array(f.pack.bytes); corrupted[corrupted.length - 1] = corrupted.at(-1)! ^ 1;
		await withCanonicalTransport(f, () => assert.rejects(validateFramescaperRawImageAssetBodyCurrentV1(selected,
			new Blob([corrupted.buffer], { type: selected.mimeType })), /digest|SHA|checksum/iu));
	} finally { await f.close(); }
});

test('Current catalog archive scalar closure accepts complete saved recipe4 without granting bodies or changing source metadata', () => {
	const template = queryPhotoV1(), develop = recipe(), document = normalizePhotoDocumentCurrentV1({ ...template, schemaVersion: 3,
		versions: template.versions.map(version => ({ ...version, develop })) }), before = structuredClone(document);
	const closure = createPhotoCatalogArchiveReachabilityCurrentV1(); closure.addPhoto(document);
	assert.deepEqual(closure.finish(), { luts: [], brushes: [] }); assert.deepEqual(document, before);
});
