/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/editor/closed-domain-value.ts';
import type { FramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';
import { collectFramescaperImageProjectResourcesCurrentV1 } from '../common/editor/video-cube-lut-project-references-current-v1.ts';
import { normalizeBrushMaskResourceReferenceV1, withBrushMaskResourceV1, type BrushMaskResourceReferenceV1 } from '../common/editor/imaging/brush-mask-resource-v1.ts';
import type { ScapeManifest, ScapeAssetDescriptor } from '../common/editor/scape-archive-envelope.ts';
import type { PlannedScapeExportAsset } from '../common/editor/scape-export-plan.ts';
import type { ScapeProjectAssetExtensionImportRequest } from '../common/editor/scape-project-asset-extension.ts';
import type { OwnedMediaAssetPublication, OwnedMediaAssetWriter } from '../common/editor/storage/media-asset-write-contract.ts';
import { createFramescaperMaskRasterSourceTimelineImageV1 } from './timeline-image-mask-raster-source-v1.ts';

export const FRAMESCAPER_MASK_RASTER_ASSET_KIND_V1 = 'photo-mask-raster' as const;
const ENCODING = 'lightscaper-mask-raster-v1', MIME = 'application/octet-stream';
const CHECK = AbortSignal.prototype.throwIfAborted, SET = Uint8Array.prototype.set, FILL = Uint8Array.prototype.fill;
const BLOB_SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!, READ = Blob.prototype.arrayBuffer;
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!, LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
interface MetadataStore { getMediaAssetMetadata(key: string): PromiseLike<unknown> | unknown }
export interface FramescaperMaskRasterArchiveValidationV1 {
	readonly references: readonly Readonly<BrushMaskResourceReferenceV1>[];
	readonly descriptors: ReadonlyMap<string, ScapeAssetDescriptor>;
}
function descriptor(reference: Readonly<BrushMaskResourceReferenceV1>): ScapeAssetDescriptor {
	return { sourceId: reference.storageKey, kind: FRAMESCAPER_MASK_RASTER_ASSET_KIND_V1, entry: `assets/masks/${reference.sha256}.scmask`,
		encoding: ENCODING, mimeType: MIME, size: reference.byteLength, sha256: reference.sha256 };
}
export async function planFramescaperMaskRasterArchiveAssetsV1(project: FramescaperProjectTimelineImage, store: MetadataStore, signal?: AbortSignal): Promise<readonly PlannedScapeExportAsset[]> {
	const references = collectFramescaperImageProjectResourcesCurrentV1(project).brushes, assets: PlannedScapeExportAsset[] = [];
	for (const reference of references) {
		check(signal); const metadata = await store.getMediaAssetMetadata(reference.storageKey); check(signal); assertMetadata(metadata, reference);
		assets.push(Object.freeze({ ...descriptor(reference), source: Object.freeze({ name: reference.storageKey, maskRasterReference: reference }),
			storageKey: reference.storageKey, expectedSha256: reference.sha256, mimeType: MIME }));
	}
	return Object.freeze(assets);
}
export function validateFramescaperMaskRasterArchiveAssetsV1(project: FramescaperProjectTimelineImage, manifest: ScapeManifest): Readonly<FramescaperMaskRasterArchiveValidationV1> {
	const references = collectFramescaperImageProjectResourcesCurrentV1(project).brushes, rows = manifest.assets.filter(value => value.kind === FRAMESCAPER_MASK_RASTER_ASSET_KIND_V1);
	if (rows.length !== references.length) throw new Error('Frame brush archive has an incomplete declared body inventory.');
	const descriptors = new Map<string, ScapeAssetDescriptor>();
	for (const row of rows) { if (descriptors.has(row.sourceId)) throw new Error('Frame brush archive repeats a body identity.'); descriptors.set(row.sourceId, row); }
	for (const reference of references) { const row = descriptors.get(reference.storageKey), expected = descriptor(reference);
		if (!row || Object.entries(expected).some(([key, value]) => row[key as keyof ScapeAssetDescriptor] !== value)) throw new Error('Frame brush descriptor differs from its complete source reference.'); }
	return Object.freeze({ references, descriptors });
}
export async function validateFramescaperMaskRasterArchiveBodyV1(asset: PlannedScapeExportAsset, body: Blob, signal?: AbortSignal): Promise<void> {
	const source = record(asset.source, 'Frame mask plan source', ['name', 'maskRasterReference']);
	const raw = record(field(source, 'maskRasterReference', 'Frame mask plan'), 'Frame mask reference', ['storageKey', 'sha256', 'width', 'height', 'byteLength']);
	const value = normalizeBrushMaskResourceReferenceV1(field(raw, 'storageKey', 'Frame mask reference'));
	for (const key of ['storageKey', 'sha256', 'width', 'height', 'byteLength'] as const) if (field(raw, key, 'Frame mask reference') !== value[key]) throw new TypeError('Frame mask plan reference differs from its exact canonical identity.');
	if (!value || asset.storageKey !== value.storageKey || asset.expectedSha256 !== value.sha256 || Object.entries(descriptor(value)).some(([key, expected]) => asset[key === 'sha256' ? 'expectedSha256' : key as keyof PlannedScapeExportAsset] !== expected)) throw new TypeError('Frame brush planned body lost its exact scalar identity.');
	await authenticate(value, body, signal);
}
export async function stageFramescaperMaskRasterArchiveAssetsV1(request: Readonly<ScapeProjectAssetExtensionImportRequest>, validation: FramescaperMaskRasterArchiveValidationV1): Promise<void> {
	const source = createFramescaperMaskRasterSourceTimelineImageV1(request.store);
	try { for (const reference of validation.references) {
		check(request.signal); const row = validation.descriptors.get(reference.storageKey)!, entry = request.entryByName.get(row.entry);
		if (!entry || entry.filename !== row.entry || entry.uncompressedSize !== reference.byteLength || typeof entry.getData !== 'function') throw new Error('Frame brush archive is missing its exact body entry.');
		const getData = entry.getData, charge = request.expandedByteBudget.consume, bytes = new Uint8Array(reference.byteLength), backing = bytes.buffer;
		let length = 0, live = true, closed = false;
		try {
			const target = new WritableStream<Uint8Array>({ write(chunk) {
				check(request.signal); if (!live || closed) throw new Error('Frame brush extraction is retired.');
				const size = Number(Reflect.apply(LENGTH, chunk, [])); if (size < 1 || size > 4 * 1024 * 1024 || size > reference.byteLength - length) throw new RangeError('Frame brush extraction exceeds its exact body.');
				const view = new Uint8Array(Reflect.apply(BUFFER, chunk, []) as ArrayBuffer, Number(Reflect.apply(OFFSET, chunk, [])), size);
				Reflect.apply(charge, request.expandedByteBudget, [size, row.entry]); Reflect.apply(SET, bytes, [view, length]); length += size;
			}, close() { check(request.signal); closed = true; } });
			await Reflect.apply(getData, entry, [target, { signal: request.signal, strictness: 'strict' }]); check(request.signal);
			if (!closed || length !== reference.byteLength) throw new Error('Frame brush extraction ended before its complete native body.');
			await withBrushMaskResourceV1({ reference, bytes, signal: request.signal }, async () => {
				const existing = await request.store.getMediaAssetMetadata(reference.storageKey); check(request.signal);
				if (existing !== null && existing !== undefined) { assertMetadata(existing, reference); await source.withBytes(reference, () => undefined, { signal: request.signal }); return; }
				await stage(reference, bytes, request); await source.withBytes(reference, () => undefined, { signal: request.signal });
			});
		} finally { live = false; if (Number(Reflect.apply(SIZE, backing, [])) !== 0) Reflect.apply(FILL, new Uint8Array(backing), [0]); }
	} } finally { await source.close(); }
}
async function stage(reference: Readonly<BrushMaskResourceReferenceV1>, bytes: Uint8Array<ArrayBuffer>, request: Readonly<ScapeProjectAssetExtensionImportRequest>): Promise<void> {
	const options = request.signal === undefined ? {} : { signal: request.signal };
	const writer = await request.store.beginMediaAssetWrite(reference.storageKey, { name: reference.storageKey, kind: FRAMESCAPER_MASK_RASTER_ASSET_KIND_V1, encoding: ENCODING, mimeType: MIME },
		{ ...options, expectedBytes: reference.byteLength, expectedSha256: reference.sha256 }) as OwnedMediaAssetWriter;
	if (!writer || typeof writer.commitOwned !== 'function' || typeof writer.abort !== 'function' || typeof writer.write !== 'function' || !Number.isSafeInteger(writer.maximumChunkBytes) || writer.maximumChunkBytes < 1) throw new TypeError('Frame brush staging requires an owned native writer.');
	let publication: OwnedMediaAssetPublication | undefined, tracked = false;
	try { for (let offset = 0; offset < bytes.byteLength; offset += writer.maximumChunkBytes) { check(request.signal); await writer.write(bytes.subarray(offset, offset + writer.maximumChunkBytes), options); }
		publication = await writer.commitOwned(options); request.transaction.trackProvisionalMedia(publication); tracked = true; assertMetadata(publication.metadata, reference); check(request.signal);
	} catch (primary) { if (tracked) throw primary;
		try { if (publication) await publication.discardIfCurrent(); else await writer.abort(); } catch (cleanup) { if (!Object.is(primary, cleanup)) throw new AggregateError([primary, cleanup], 'Frame brush staging and native cleanup failed.', { cause: cleanup }); }
		throw primary;
	}
}
async function authenticate(reference: Readonly<BrushMaskResourceReferenceV1>, body: Blob, signal?: AbortSignal): Promise<void> {
	check(signal); if (Number(Reflect.apply(BLOB_SIZE, body, [])) !== reference.byteLength) throw new Error('Frame brush body has a stale native size.');
	const backing = await Reflect.apply(READ, body, []) as ArrayBuffer, bytes = new Uint8Array(backing);
	try { await withBrushMaskResourceV1({ reference, bytes, signal }, () => undefined); } finally { if (Number(Reflect.apply(SIZE, backing, [])) !== 0) Reflect.apply(FILL, new Uint8Array(backing), [0]); }
}
function assertMetadata(value: unknown, reference: Readonly<BrushMaskResourceReferenceV1>): void {
	if (!value || typeof value !== 'object') throw new Error('Frame brush native body is missing.'); const row = value as Readonly<Record<string, unknown>>;
	if (row.size !== reference.byteLength || row.sha256 !== reference.sha256 || (row.mimeType && row.mimeType !== MIME)) throw new Error('Frame brush native metadata differs from its exact declaration.');
}
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
