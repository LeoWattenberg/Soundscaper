/* SPDX-License-Identifier: AGPL-3.0-only */

import { aggregateScapeErrors } from '../../common/editor/scape-abort.ts';
import { readScapeArchiveEnvelope, type ScapeManifest } from '../../common/editor/scape-archive-envelope.ts';
import { verifyScapeAssetBytes } from '../../common/editor/scape-archive-media.ts';
import { withScapeProjectInput, type ScapeProjectInput, type ScapeProjectInputReaderFactories } from '../../common/editor/scape-project-input.ts';
import { parseOpaqueScapeProjectDocument } from '../../common/editor/scape-project-document.ts';
import { readClosedDomainField, readClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import type { PhotoCatalogRootV1 } from '../catalog/types.ts';
import type { PhotoSmartCollectionV1 } from '../catalog/photo-smart-collection-v1.ts';
import type { PhotoSmartCollectionsStateV1 } from '../catalog/photo-smart-collection-state-v1.ts';
import { PHOTO_CATALOG_ARCHIVE_LIMITS_V1 as LIMITS, PhotoCatalogArchiveIdentityGuard, assertPhotoCatalogPackManifestV1, normalizePhotoCatalogArchiveV1 } from './catalog-archive-contract.ts';
import { admitPhotoArchiveStackV2, assertPhotoCatalogPackManifestV2, normalizePhotoCatalogArchiveV2 } from './catalog-archive-contract-v2.ts';
import { assertPhotoCatalogPackManifestV3, normalizePhotoCatalogArchiveV3 } from './catalog-archive-contract-v3.ts';
import { PhotoCatalogArchiveIdentityLedger } from './catalog-archive-identities.ts';
import type { PhotoCatalogArchiveStageV2 } from './catalog-archive-import-v2.ts';
import { PhotoCatalogArchiveSavedCollectionGuardV3 } from './catalog-archive-saved-collection-guard-v3.ts';
import { readPhotoCatalogPackEntryV1 } from './catalog-pack-entry.ts';
import { readPhotoStackPackEntryV1 } from './stack-pack-entry.ts';
import { readPhotoSmartCollectionPackEntryV1 } from './smart-collection-pack-entry-v1.ts';
import { assertPhotoStackQuerySignalV1 } from '../catalog/photo-stack-query-signal-v1.ts';
import type { PhotoDocumentV1 } from '../catalog/types.ts';
import type { PhotoDocumentV2 } from '../catalog/photo-document-v2.ts';
import type { PhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import type { PhotoDevelopPresetRowCurrentV1 } from '../storage/photo-develop-preset-row-current-v1.ts';
import { createPhotoCatalogArchiveReachabilityCurrentV1 } from './catalog-archive-reachability-current-v1.ts';
import { readPhotoCatalogPackEntryV4 } from './catalog-pack-entry-v4.ts';
import { readPhotoDevelopPresetPackEntryV3 } from './develop-preset-pack-entry-v3.ts';
import { normalizePhotoCatalogArchiveV7, assertPhotoCatalogPackManifestV7,
	type PhotoCatalogArchiveDevelopPresetPackV7 } from './catalog-archive-contract-v7.ts';
import type { PhotoDevelopPresetRowV2 } from '../storage/photo-develop-preset-row-v2.ts';
import type { VideoCubeLutReferenceV1 } from '../../common/editor/video-color-cube-lut-v27.ts';
import { createPhotoCubeLutReachabilityV1 } from '../catalog/photo-cube-lut-reachability-v1.ts';
import { readPhotoCatalogPackEntryV2 } from './catalog-pack-entry-v2.ts';
import { readPhotoDevelopPresetPackEntryV2 } from './develop-preset-pack-entry-v2.ts';
import { readPhotoCubeLutArchiveEntryV1 } from './cube-lut-archive-entry-v1.ts';
import { normalizePhotoCatalogArchiveV5, assertPhotoCatalogPackManifestV5, type PhotoCatalogArchiveDevelopPresetPackV5, type PhotoCatalogArchiveLutResourceV5 } from './catalog-archive-contract-v5.ts';
import type { PhotoDevelopPresetRowV1 } from '../storage/photo-develop-presets-v1.ts';
import { normalizePhotoCatalogArchiveV4, assertPhotoCatalogPackManifestV4, type PhotoCatalogArchiveDevelopPresetPackV4 } from './catalog-archive-contract-v4.ts';
import { readPhotoDevelopPresetPackEntryV1 } from './develop-preset-pack-entry-v1.ts';

import type { BrushMaskResourceReferenceV1 } from '../../common/editor/imaging/brush-mask-resource-v1.ts';
import { createPhotoMaskRasterReachabilityV1 } from '../catalog/photo-mask-raster-reachability-v1.ts';
import { readPhotoCatalogPackEntryV3 } from './catalog-pack-entry-v3.ts';
import { readPhotoMaskRasterArchiveEntryV1 } from './mask-raster-archive-entry-v1.ts';
import { normalizePhotoCatalogArchiveV6, assertPhotoCatalogPackManifestV6, type PhotoCatalogArchiveDocumentV6,
	type PhotoCatalogArchiveMaskRasterResourceV6 } from './catalog-archive-contract-v6.ts';

/** All borrowed writes remain provisional; fulfilled publish is the destination's durable ACK. */
export interface PhotoCatalogArchiveStageV5 extends Omit<PhotoCatalogArchiveStageV2, 'writePhoto'> {
	writePhoto(photo: PhotoDocumentV1 | PhotoDocumentV2, original: AsyncIterable<Uint8Array>): Promise<void>;
	writeLut(reference: Readonly<VideoCubeLutReferenceV1>, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
	writeSavedCollection(definition: PhotoSmartCollectionV1): Promise<void>;
	writeDevelopPresets(row: PhotoDevelopPresetRowV1 | PhotoDevelopPresetRowV2): Promise<void>;
}
export type PhotoCatalogArchivePresetHeaderV5 = Readonly<PhotoCatalogArchiveDevelopPresetPackV5>
	| Readonly<PhotoCatalogArchiveDevelopPresetPackV4 & { readonly rowSchemaVersion: 1 }>;
export type PhotoCatalogArchiveStageFactoryV5 = (root: PhotoCatalogRootV1,
	savedCollectionState: Readonly<PhotoSmartCollectionsStateV1> | null,
	developPresetPack: PhotoCatalogArchivePresetHeaderV5 | null,
	lutResources: readonly Readonly<PhotoCatalogArchiveLutResourceV5>[]) => Promise<PhotoCatalogArchiveStageV5>;

export interface PhotoCatalogArchiveStageV6 extends PhotoCatalogArchiveStageV5 {
	writeMaskRaster(reference: Readonly<BrushMaskResourceReferenceV1>, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
}
export type PhotoCatalogArchiveStageFactoryV6 = (root: PhotoCatalogRootV1,
	savedCollectionState: Readonly<PhotoSmartCollectionsStateV1> | null,
	developPresetPack: PhotoCatalogArchivePresetHeaderV5 | null,
	lutResources: readonly Readonly<PhotoCatalogArchiveLutResourceV5>[],
	maskRasters: readonly Readonly<PhotoCatalogArchiveMaskRasterResourceV6>[]) => Promise<PhotoCatalogArchiveStageV6>;
export interface PhotoCatalogArchiveStageV7 extends Omit<PhotoCatalogArchiveStageV6, 'writePhoto' | 'writeDevelopPresets'> {
	writePhoto(photo: PhotoDocumentCurrentV1, original: AsyncIterable<Uint8Array>): Promise<void>;
	writeDevelopPresets(row: PhotoDevelopPresetRowCurrentV1): Promise<void>;
}
export type PhotoCatalogArchivePresetHeaderV7 = PhotoCatalogArchivePresetHeaderV5 | Readonly<PhotoCatalogArchiveDevelopPresetPackV7>;
export type PhotoCatalogArchiveStageFactoryV7 = (root: PhotoCatalogRootV1,
	savedCollectionState: Readonly<PhotoSmartCollectionsStateV1> | null,
	developPresetPack: PhotoCatalogArchivePresetHeaderV7 | null,
	lutResources: readonly Readonly<PhotoCatalogArchiveLutResourceV5>[],
	maskRasters: readonly Readonly<PhotoCatalogArchiveMaskRasterResourceV6>[]) => Promise<PhotoCatalogArchiveStageV7>;
type KernelFactory = PhotoCatalogArchiveStageFactoryV5 | PhotoCatalogArchiveStageFactoryV6 | PhotoCatalogArchiveStageFactoryV7;
type AdmittedDocument = Omit<PhotoCatalogArchiveDocumentV6, 'schemaVersion' | 'developPresetPack'> & {
	readonly schemaVersion: 5 | 6 | 7; readonly developPresetPack: PhotoCatalogArchivePresetHeaderV7 | null };

/** Preserve archived values; this codec neither remaps identities nor owns a database/writer. */
export async function importPhotoCatalogArchiveKernel(input: ScapeProjectInput, createStage: KernelFactory,
	options: Readonly<{ signal?: AbortSignal; readerFactories?: ScapeProjectInputReaderFactories }>, maximumVersion: 5 | 6 | 7): Promise<PhotoCatalogRootV1> {
	if (maximumVersion !== 5 && maximumVersion !== 6 && maximumVersion !== 7) throw new RangeError('Unsupported fixed archive import version.');
	if (typeof createStage !== 'function') throw new TypeError('A provisional photo catalog destination is required.');
	const admitted = readClosedDomainRecord(options, 'archive import options', ['signal', 'readerFactories'], []);
	const signal = Object.hasOwn(admitted, 'signal') ? readClosedDomainField(admitted, 'signal', 'archive import options') as AbortSignal | undefined : undefined;
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const readers = Object.hasOwn(admitted, 'readerFactories') ? readClosedDomainField(admitted, 'readerFactories', 'archive import options') as ScapeProjectInputReaderFactories : undefined;
	let stage: PhotoCatalogArchiveStageV7 | undefined, rollback: (() => Promise<void>) | undefined, published = false;
	try {
		const root = await withScapeProjectInput(input, signal, async entries => {
			const envelope = await readScapeArchiveEnvelope(entries, { maximumProjectBytes: LIMITS.maximumDocumentBytes }, signal);
			verifyScapeAssetBytes(new TextEncoder().encode(envelope.projectText), envelope.manifest.project, 'photo catalog document');
			const admittedArchive = admitArchive(parseOpaqueScapeProjectDocument(envelope.projectText), envelope.manifest, maximumVersion);
			const { document, legacy } = admittedArchive;
			checkSignal(signal); const acquired = await Reflect.apply(createStage, undefined, [document.catalog, document.savedCollectionState,
				document.developPresetPack, document.lutResources, document.maskRasters]) as PhotoCatalogArchiveStageV5 | PhotoCatalogArchiveStageV6 | PhotoCatalogArchiveStageV7;
			if (!acquired) throw new TypeError('Photo catalog stage is incomplete.');
			const owner = acquired, leave = owner.rollback;
			if (typeof leave === 'function') rollback = () => Reflect.apply(leave, owner, []) as Promise<void>;
			const target = captureStage(owner, leave, document.schemaVersion >= 6);
			checkSignal(signal);
			stage = target; const reachability = createPhotoCubeLutReachabilityV1(), masks = document.schemaVersion === 6 ? createPhotoMaskRasterReachabilityV1() : undefined;
			const current = document.schemaVersion === 7 ? createPhotoCatalogArchiveReachabilityCurrentV1() : undefined;
			const identities = new PhotoCatalogArchiveIdentityLedger(), photos = new PhotoCatalogArchiveIdentityGuard(document.catalog, identities);
			const saved = new PhotoCatalogArchiveSavedCollectionGuardV3(document.catalog, document.savedCollectionState);
			const assets = new Map(envelope.manifest.assets.map(asset => [asset.sourceId, asset]));
			for (const pack of document.packs) {
				const entry = envelope.entryByName.get(pack.entry), asset = assets.get(pack.id);
				if (!entry || !asset) throw new Error('Photo archive pack is unavailable.');
				const count = await (legacy ? readPhotoCatalogPackEntryV1 : document.schemaVersion === 7 ? readPhotoCatalogPackEntryV4 : document.schemaVersion === 6 ? readPhotoCatalogPackEntryV3 : readPhotoCatalogPackEntryV2)(entry, asset, envelope.expandedByteBudget, async (photo: PhotoDocumentCurrentV1, original) => {
					photos.admit(photo); if (current) current.addPhoto(photo); else { reachability.addPhoto(photo); masks?.addPhoto(photo); }
					await target.writePhoto(photo, original);
				}, signal);
				if (count !== pack.photoCount) throw new RangeError('Photo archive pack differs from its declared record count.');
			}
			if (photos.count !== document.catalog.photoCount) throw new RangeError('Photo archive differs from its declared catalog count.');
			for (const pack of document.stackPacks) {
				const entry = envelope.entryByName.get(pack.entry), asset = assets.get(pack.id);
				if (!entry || !asset) throw new Error('Stack archive pack is unavailable.');
				const count = await readPhotoStackPackEntryV1(entry, asset, envelope.expandedByteBudget, async stack => {
					admitPhotoArchiveStackV2(stack, document.catalog.id, identities); await target.writeStack(stack);
				}, signal);
				if (count !== pack.stackCount) throw new RangeError('Stack archive pack differs from its declared record count.');
			}
			if (identities.stackCount !== document.stackCount) throw new RangeError('Archive differs from its declared stack count.');
			for (const pack of document.savedCollectionPacks) {
				const entry = envelope.entryByName.get(pack.entry), asset = assets.get(pack.id);
				if (!entry || !asset) throw new Error('Saved collection archive pack is unavailable.');
				const count = await readPhotoSmartCollectionPackEntryV1(entry, asset, envelope.expandedByteBudget, async definition => {
					saved.admit(definition); await target.writeSavedCollection(definition);
				}, signal);
				if (count !== pack.collectionCount) throw new RangeError('Saved collection archive pack differs from its declared record count.');
			}
			saved.finish();
			const pack = document.developPresetPack;
			if (pack) {
				const entry = envelope.entryByName.get(pack.entry), asset = assets.get(pack.id);
				if (!entry || !asset) throw new Error('Develop preset archive pack is unavailable.');
				await (legacy ? readPhotoDevelopPresetPackEntryV1 : document.schemaVersion === 7 ? readPhotoDevelopPresetPackEntryV3 : readPhotoDevelopPresetPackEntryV2)(entry, asset, envelope.expandedByteBudget, document.catalog.id, async (row: PhotoDevelopPresetRowCurrentV1) => {
					if (row.schemaVersion !== pack.rowSchemaVersion || row.revision !== pack.revision || row.presets.length !== pack.presetCount) throw new Error('Develop preset row differs from its archive header.');
					if (current) current.addPresetRow(row, document.catalog.id);
					else for (const preset of row.presets) { reachability.addPreset(preset); masks?.addPreset(preset); }
					await target.writeDevelopPresets(row);
				}, signal);
			}
			const currentReferences = current?.finish(), reached = currentReferences?.luts ?? reachability.finish();
			if (JSON.stringify(reached) !== JSON.stringify(document.lutResources.map(resource => resource.reference))) throw new TypeError('Archive declared LUT resources differ from complete reachable custody.');
			if (masks && JSON.stringify(masks.finish()) !== JSON.stringify(document.maskRasters.map(resource => resource.reference))) throw new TypeError('Archive declared mask resources differ from complete reachable custody.');
			if (currentReferences && JSON.stringify(currentReferences.brushes) !== JSON.stringify(document.maskRasters.map(resource => resource.reference))) throw new TypeError('Archive declared mask resources differ from complete reachable custody.');
			for (const resource of document.lutResources) {
				const entry = envelope.entryByName.get(resource.entry), asset = assets.get(resource.id);
				if (!entry || !asset) throw new Error('LUT archive resource is unavailable.');
				await readPhotoCubeLutArchiveEntryV1(entry, asset, envelope.expandedByteBudget, resource.reference, target.writeLut, signal);
			}
			for (const resource of document.maskRasters) {
				const entry = envelope.entryByName.get(resource.entry), asset = assets.get(resource.id);
				if (!entry || !asset) throw new Error('Mask archive resource is unavailable.');
				await readPhotoMaskRasterArchiveEntryV1(entry, asset, envelope.expandedByteBudget, resource.reference, target.writeMaskRaster, signal);
			}
			return document.catalog;
		}, readers);
		// Authentication, decoder/extractor joining and ZIP reader closure precede publication.
		checkSignal(signal); if (!stage) throw new Error('Photo catalog stage was not prepared.');
		await stage.publish(); published = true;
		// No cancellation probe follows the known publication ACK.
		return root;
	} catch (error) {
		const cleanup: unknown[] = [];
		if (!published && rollback) {
			try { await rollback(); } catch (failure) { cleanup.push(failure); }
		}
		const observed = signal !== undefined && Reflect.apply(nativeAborted, signal, []) === true
			&& Object.is(error, Reflect.apply(nativeReason, signal, []));
		throw aggregateScapeErrors(error, cleanup, 'Photo preset archive import and rollback failed.', { primaryIsAbort: observed });
	}
}

function admitArchive(parsed: unknown, manifest: ScapeManifest, maximumVersion: 5 | 6 | 7): Readonly<{ document: AdmittedDocument; legacy: boolean }> {
	const value = readClosedDomainRecord(parsed, 'catalog archive identity', ['schemaFamily', 'schemaVersion', 'kind', 'id', 'title',
		'catalog', 'packs', 'stackCount', 'stackPacks', 'savedCollectionState', 'savedCollectionPacks', 'developPresetPack', 'lutResources', ...(maximumVersion >= 6 ? ['maskRasters'] : [])], ['schemaFamily', 'schemaVersion']);
	const version = readClosedDomainField(value, 'schemaVersion', 'catalog archive identity');
	if (version === 7 && maximumVersion === 7) { const document = normalizePhotoCatalogArchiveV7(parsed); assertPhotoCatalogPackManifestV7(document, manifest); return { document, legacy: false }; }
	if (version === 6 && maximumVersion >= 6) { const document = normalizePhotoCatalogArchiveV6(parsed); assertPhotoCatalogPackManifestV6(document, manifest); return { document, legacy: false }; }
	if (version === 5) { const document = normalizePhotoCatalogArchiveV5(parsed); assertPhotoCatalogPackManifestV5(document, manifest); return { document: { ...document, maskRasters: [] }, legacy: false }; }
	const old = version === 1 ? normalizePhotoCatalogArchiveV1(parsed) : version === 2 ? normalizePhotoCatalogArchiveV2(parsed)
		: version === 3 ? normalizePhotoCatalogArchiveV3(parsed) : normalizePhotoCatalogArchiveV4(parsed);
	if (manifest.project.schemaFamily !== 'lightscaper' || manifest.project.schemaVersion !== old.schemaVersion) throw new TypeError('Archive manifest schema differs from its document.');
	if (old.schemaVersion === 1) assertPhotoCatalogPackManifestV1(old, manifest);
	else if (old.schemaVersion === 2) assertPhotoCatalogPackManifestV2(old, manifest);
	else if (old.schemaVersion === 3) assertPhotoCatalogPackManifestV3(old, manifest);
	else assertPhotoCatalogPackManifestV4(old, manifest);
	const preset = old.schemaVersion === 4 ? old.developPresetPack : null;
	// The internally retained header preserves the old physical entry; it is
	// never passed to the V5 serialized-header normalizer or written as V5.
	const header = preset === null ? null : Object.freeze({ ...preset, rowSchemaVersion: 1 as const });
	return { legacy: true, document: { ...old, schemaVersion: 5,
		stackCount: old.schemaVersion === 1 ? 0 : old.stackCount,
		stackPacks: old.schemaVersion === 1 ? [] : old.stackPacks,
		savedCollectionState: old.schemaVersion === 3 || old.schemaVersion === 4 ? old.savedCollectionState : null,
		savedCollectionPacks: old.schemaVersion === 3 || old.schemaVersion === 4 ? old.savedCollectionPacks : [],
		developPresetPack: header, lutResources: [], maskRasters: [] } };
}

function captureStage(stage: PhotoCatalogArchiveStageV5 | PhotoCatalogArchiveStageV6 | PhotoCatalogArchiveStageV7, rollback: PhotoCatalogArchiveStageV5['rollback'], requireMasks: boolean): PhotoCatalogArchiveStageV7 {
	const photo = stage.writePhoto, stack = stage.writeStack, saved = stage.writeSavedCollection, presets = stage.writeDevelopPresets,
		lut = stage.writeLut, publish = stage.publish;
	const mask = requireMasks && 'writeMaskRaster' in stage ? stage.writeMaskRaster : undefined;
	if ([photo, stack, saved, presets, lut, publish, rollback, ...(requireMasks ? [mask] : [])].some(method => typeof method !== 'function')) throw new TypeError('Photo catalog stage is incomplete.');
	return Object.freeze({ writePhoto: (...args: Parameters<PhotoCatalogArchiveStageV7['writePhoto']>) => Reflect.apply(photo, stage, args) as Promise<void>,
		writeStack: (...args: Parameters<typeof stack>) => Reflect.apply(stack, stage, args) as Promise<void>,
		writeSavedCollection: (...args: Parameters<typeof saved>) => Reflect.apply(saved, stage, args) as Promise<void>,
		writeDevelopPresets: (...args: Parameters<PhotoCatalogArchiveStageV7['writeDevelopPresets']>) => Reflect.apply(presets, stage, args) as Promise<void>,
		writeLut: (...args: Parameters<typeof lut>) => Reflect.apply(lut, stage, args) as Promise<void>,
		writeMaskRaster: (...args: Parameters<PhotoCatalogArchiveStageV6['writeMaskRaster']>) => {
			if (typeof mask !== 'function') return Promise.reject(new TypeError('Legacy destination has no mask transport.'));
			return Reflect.apply(mask, stage, args) as Promise<void>;
		},
		publish: () => Reflect.apply(publish, stage, []) as Promise<void>, rollback: () => Reflect.apply(rollback, stage, []) as Promise<void> });
}
const nativeAbort = AbortSignal.prototype.throwIfAborted;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
function checkSignal(signal?: AbortSignal): void { if (signal) Reflect.apply(nativeAbort, signal, []); }
