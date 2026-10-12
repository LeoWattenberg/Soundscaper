/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BlobReader, BlobWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import { exportPhotoFramescaperHandoffArchiveCurrentV1 } from '../../src/lightscaper/controller/photo-framescaper-handoff-archive-current-v1.ts';
import { withPhotoFramescaperHandoffReadCurrentV1 } from '../../src/lightscaper/controller/photo-framescaper-handoff-read-current-v1.ts';
import type { PhotoLibraryImageHandoffViewV1 } from '../../src/common/editor/photo-library-image-handoff-port-v1.ts';
import type { PhotoLibraryImageReceiveReceiptV1 } from '../../src/common/editor/photo-library-image-receive-port-v1.ts';
import type { MaskRasterSourcePortV1 } from '../../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import type { BrushMaskResourceReferenceV1 } from '../../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { withPreparedBrushMaskResourceV1 } from '../../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { OpenFramescaperBrowserNativeImageV1 } from '../../src/common/editor/timeline-image-native-decode-v1.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { applyPhotoCommandCurrentV1 } from '../../src/lightscaper/controller/photo-commands-current-v1.ts';
import { repairBackupCurrentFixture, readRepairBackupArchive } from './lightscaper-repair-backup-current-fixture.ts';
import { decodePng, ORIGINAL, repairRecipe } from './lightscaper-repair-raster-export-current-fixture.ts';
import { LUT_BODY, LUT_REFERENCE, profile } from './lightscaper-masked-frame-fixture.ts';
import { SETTINGS_TIME } from './lightscaper-repair-settings-current-fixture.ts';

export interface RepairImageCaptureView extends Omit<PhotoLibraryImageHandoffViewV1, 'schemaVersion'> {
	readonly schemaVersion: 2;
	readonly maskRasterReferences: readonly Readonly<BrushMaskResourceReferenceV1>[];
	readonly withMaskRasterBytes: MaskRasterSourcePortV1['withBytes'];
}
export interface RepairImageReadView extends Omit<RepairImageCaptureView, 'factsJson' | 'original'> {
	readonly source: Readonly<Record<string, unknown>>;
	readonly canonicalFrameSha256: string;
	readonly projectId: string;
	readonly projectRevision: number;
}
export interface RepairImageReceipt extends Omit<PhotoLibraryImageReceiveReceiptV1, 'schemaVersion'> { readonly schemaVersion: 2 }
export function observed<Value>(work: Promise<Value>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
export function sha256(bytes: Uint8Array | string) { return createHash('sha256').update(bytes).digest('hex'); }

/** Decode only real PNG bytes below the unchanged Original signature/SHA/size
 * owner. These Node intrinsics qualify custody and control flow, not native browser pixels. */
function nativePngBoundary() {
	const keys = ['ImageDecoder', 'createImageBitmap', 'OffscreenCanvas'] as const, saved = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
	const bitmaps = new WeakMap<object, Uint8Array>();
	class Canvas {
		pixels = new Uint8Array(0);
		constructor(readonly width: number, readonly height: number) {}
		getContext() { return { drawImage: (bitmap: object) => { const pixels = bitmaps.get(bitmap); assert.ok(pixels); this.pixels = pixels.slice(); },
			getImageData: () => ({ data: new Uint8ClampedArray(this.pixels) }), clearRect: () => { this.pixels.fill(0); } }; }
	}
	const createImageBitmap = async (body: Blob) => { const image = decodePng(new Uint8Array(await Blob.prototype.arrayBuffer.call(body))), bitmap = {
		width: image.width, height: image.height, close() { image.pixels.fill(0); } }; bitmaps.set(bitmap, image.pixels); return bitmap; };
	for (const [index, value] of [undefined, createImageBitmap, Canvas].entries()) Object.defineProperty(globalThis, keys[index]!, { configurable: true, value });
	return () => { for (const [index, key] of keys.entries()) { const descriptor = saved[index];
		if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } };
}

export async function repairFrameHandoffFixture(placement: 'active' | 'redo' | 'snapshot' | 'legacy' | 'brush2' = 'active', resources = false) {
	const restore = nativePngBoundary();
	let f: Awaited<ReturnType<typeof repairBackupCurrentFixture>> | undefined;
	try {
		f = await repairBackupCurrentFixture(placement === 'brush2' ? 'legacy' : placement, 1); const actual = f;
		const references: Readonly<BrushMaskResourceReferenceV1>[] = [], bodies = new Map<string, Uint8Array<ArrayBuffer>>();
		if (placement === 'brush2') { const reference = await actual.saveLegacyBrush(); references.push(reference);
			const masks = await actual.media.getMaskRasterResources(); await masks.source.withBytes(reference, bytes => { bodies.set(reference.storageKey, bytes.slice()); });
			actual.events.splice(0); actual.borrowed.splice(0); }
		if (resources) {
			const masks = await actual.media.getMaskRasterResources(), luts = await actual.media.getCubeLutResources();
			for (const alpha of [[255, 0, 128], [31, 192, 64]]) await withPreparedBrushMaskResourceV1({ width: 3, height: 1, alpha: Uint8Array.from(alpha) }, async body => {
				await masks.put(body.reference, body.bytes); references.push(body.reference); bodies.set(body.reference.storageKey, body.bytes.slice());
			});
			await luts.put(LUT_REFERENCE, LUT_BODY); bodies.set(LUT_REFERENCE.storageKey, new Uint8Array(LUT_BODY));
			const before = actual.records[0]!.photo, version = before.versions.find(value => value.id === before.activeVersionId)!;
			const develop = normalizeImageDevelopStateCurrentV1({ ...version.develop, processVersion: 3, repairs: repairRecipe().repairs, effects: [profile(false)], masks: [{ schemaVersion: 2, name: 'Retained paint', id: 'painted', kind: 'matte',
				inputs: references.map((reference, index) => ({ name: `alpha-${index}`, kind: 'alpha', sourceRef: reference.storageKey })),
				nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'alpha-0' }], outputNodeId: 'alpha' }], maskBindings: [] });
			let photo = applyPhotoCommandCurrentV1(before, { type: 'record-develop', versionId: version.id, develop, label: 'Declared resources', createdAt: SETTINGS_TIME });
			if (placement === 'redo') photo = applyPhotoCommandCurrentV1(photo, { type: 'select-develop-history', cursor: 0 });
			if (placement === 'snapshot') { photo = applyPhotoCommandCurrentV1(photo, { type: 'save-develop-snapshot', id: 'resource-snapshot', name: 'Resource snapshot', createdAt: SETTINGS_TIME });
				photo = applyPhotoCommandCurrentV1(photo, { type: 'select-develop-history', cursor: 0 }); }
			actual.records[0]!.photo = await actual.catalog.savePhoto(photo, before.revision); actual.events.splice(0); actual.borrowed.splice(0);
		}
		const photo = actual.records[0]!.photo, version = photo.versions.find(value => value.id === photo.activeVersionId)!;
		const binding = { catalogId: photo.catalogId, photoId: photo.id, versionId: version.id, expectedRevision: photo.revision };
		const hooks: { nativeDecode?: () => Promise<void>; nativeClose?: () => void } = {};
		const openImage: OpenFramescaperBrowserNativeImageV1 = async function (this: unknown, request) {
			assert.equal(this, dependencies); actual.events.push('native-open'); const value = decodePng(request.bytes);
			return { metadata: { width: value.width, height: value.height, frameCount: 1, topology: 'single', runtimeVersion: 'actual-png-node-boundary' },
				async decodeFrame(index) { assert.equal(index, 0); await hooks.nativeDecode?.(); actual.events.push('native-decode'); return { rgba: value.pixels.slice(), durationMicroseconds: null }; },
				close() { actual.events.push('native-close'); value.pixels.fill(0); hooks.nativeClose?.(); } };
		};
		let nextId = 0;
		const dependencies: { openImage: OpenFramescaperBrowserNativeImageV1; createId: () => string; now: () => string } = { openImage, createId: () => `handoff-${++nextId}`, now: () => SETTINGS_TIME };
		return { ...actual, photo, version, binding, references, bodies, nativeHooks: hooks, dependencies,
			async capture<Value>(consume: (view: Readonly<RepairImageCaptureView>) => Value | Promise<Value>, options: { signal?: AbortSignal } = {}, request: unknown = binding): Promise<Value> {
				const port = actual.session.imageHandoffCurrent; assert.ok(port);
				return Reflect.apply(port.withCapture, port, [request, consume, options]) as Promise<Value>;
			},
			async archive(signal?: AbortSignal) {
				const capture = actual.session.imageHandoffCurrent; assert.ok(capture);
				return Reflect.apply(exportPhotoFramescaperHandoffArchiveCurrentV1, undefined, [{ capture, binding, ...(signal ? { signal } : {}) }, dependencies]) as ReturnType<typeof exportPhotoFramescaperHandoffArchiveCurrentV1>;
			},
			async read<Value>(archive: Blob, sourceId: string, consume: (view: Readonly<RepairImageReadView>) => Value | Promise<Value>, signal?: AbortSignal): Promise<Value> {
				return Reflect.apply(withPhotoFramescaperHandoffReadCurrentV1, undefined, [{ archive, sourceId, ...(signal ? { signal } : {}) }, consume]) as Promise<Value>;
			},
			async receive(archive: Blob, sourceId: string, signal?: AbortSignal): Promise<Readonly<RepairImageReceipt>> {
				const port = actual.session.imageReceiveCurrent; assert.ok(port);
				return Reflect.apply(port.receive, port, [{ archive, sourceId }, signal ? { signal } : {}]) as Promise<Readonly<RepairImageReceipt>>;
			},
			change(value: unknown) { const document = normalizePhotoDocumentCurrentV1(value), database = actual.native.opens.find(value => value.name.startsWith('lightscaper-repair-portable-catalog-'))!.name;
				actual.native.raw(database).seedRecord(database, 'photos', { key: `${photo.catalogId}|${photo.id}`, document }); },
			async close() { try { await actual.close(); } finally { restore(); } },
		};
	} catch (error) { try { await f?.close(); } finally { restore(); } throw error; }
}

export async function rewriteRepairFrameArchive(archive: Blob, change: (project: Record<string, unknown>, entries: Map<string, Uint8Array<ArrayBuffer>>) => void) {
	const { entries, document } = await readRepairBackupArchive(archive); change(document, entries);
	const text = new TextEncoder().encode(JSON.stringify(document)); entries.set('project.json', text);
	const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json'))) as { project: { size: number; sha256: string } };
	manifest.project.size = text.byteLength; manifest.project.sha256 = sha256(text); entries.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
	const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false, level: 0 });
	for (const [name, bytes] of entries) await writer.add(name, new Uint8ArrayReader(bytes), { level: 0 });
	return writer.close();
}

/** An actual legacy archive supplies the unchanged pack. Only editable scalar
 * metadata is replaced with honest explicit Source3/Provenance2 for baseline admission. */
export async function literalRepairSourceArchive(develop: unknown) {
	const f = await repairFrameHandoffFixture('legacy');
	try { const result = await f.archive(); let sourceId = '';
		const archive = await rewriteRepairFrameArchive(result.blob, project => {
			const source = (project.sources as Record<string, unknown>[])[0]!; sourceId = source.id as string;
			const normalized = normalizeImageDevelopStateCurrentV1(develop), provenance = source.provenance as Record<string, unknown>;
			source.schemaVersion = 3; source.develop = normalized; source.provenance = { ...provenance, schemaVersion: 2,
				origin: { ...(provenance.origin as object), schemaVersion: 3 }, developSha256: sha256(JSON.stringify(normalized)) };
		});
		return { archive, sourceId, original: new Uint8Array(await f.records[0]!.original.arrayBuffer()), pixels: Uint8Array.from(ORIGINAL) };
	} finally { await f.close(); }
}

export async function readRepairFrameEntries(archive: Blob) {
	const reader = new ZipReader(new BlobReader(archive), { useWebWorkers: false }), entries = new Map<string, Uint8Array<ArrayBuffer>>();
	try { for (const entry of await reader.getEntries()) if (!entry.directory) entries.set(entry.filename, new Uint8Array(await entry.getData(new Uint8ArrayWriter()))); }
	finally { await reader.close(); }
	return entries;
}
