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
import type { PhotoDevelopPresetRowV1 } from '../storage/photo-develop-presets-v1.ts';
import { normalizePhotoCatalogArchiveV4, assertPhotoCatalogPackManifestV4, type PhotoCatalogArchiveDocumentV4, type PhotoCatalogArchiveDevelopPresetPackV4 } from './catalog-archive-contract-v4.ts';
import { readPhotoDevelopPresetPackEntryV1 } from './develop-preset-pack-entry-v1.ts';

/** All borrowed writes remain provisional; fulfilled publish is the destination's durable ACK. */
export interface PhotoCatalogArchiveStageV4 extends PhotoCatalogArchiveStageV2 {
	writeSavedCollection(definition: PhotoSmartCollectionV1): Promise<void>;
	writeDevelopPresets(row: PhotoDevelopPresetRowV1): Promise<void>;
}
export type PhotoCatalogArchiveStageFactoryV4 = (root: PhotoCatalogRootV1,
	savedCollectionState: Readonly<PhotoSmartCollectionsStateV1> | null,
	developPresetPack: Readonly<PhotoCatalogArchiveDevelopPresetPackV4> | null) => Promise<PhotoCatalogArchiveStageV4>;

/** Preserve archived values; this codec neither remaps identities nor owns a database/writer. */
export async function importPhotoCatalogArchiveV4(input: ScapeProjectInput, createStage: PhotoCatalogArchiveStageFactoryV4,
	options: Readonly<{ signal?: AbortSignal; readerFactories?: ScapeProjectInputReaderFactories }> = {}): Promise<PhotoCatalogRootV1> {
	if (typeof createStage !== 'function') throw new TypeError('A provisional photo catalog destination is required.');
	const admitted = readClosedDomainRecord(options, 'archive import options', ['signal', 'readerFactories'], []);
	const signal = Object.hasOwn(admitted, 'signal') ? readClosedDomainField(admitted, 'signal', 'archive import options') as AbortSignal | undefined : undefined;
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const readers = Object.hasOwn(admitted, 'readerFactories') ? readClosedDomainField(admitted, 'readerFactories', 'archive import options') as ScapeProjectInputReaderFactories : undefined; let stage: PhotoCatalogArchiveStageV4 | undefined, published = false;
	try {
		const root = await withScapeProjectInput(input, signal, async entries => {
			const envelope = await readScapeArchiveEnvelope(entries, { maximumProjectBytes: LIMITS.maximumDocumentBytes }, signal);
			verifyScapeAssetBytes(new TextEncoder().encode(envelope.projectText), envelope.manifest.project, 'photo catalog document');
			const document = admitArchive(parseOpaqueScapeProjectDocument(envelope.projectText), envelope.manifest);
			checkSignal(signal); stage = await createStage(document.catalog, document.savedCollectionState, document.developPresetPack);
			if (!stage || typeof stage.writePhoto !== 'function' || typeof stage.writeStack !== 'function'
				|| typeof stage.writeDevelopPresets !== 'function' || typeof stage.writeSavedCollection !== 'function' || typeof stage.publish !== 'function' || typeof stage.rollback !== 'function') {
				throw new TypeError('Photo catalog saved collection stage is incomplete.');
			}
			checkSignal(signal);
			const target = Object.freeze({ writePhoto: stage.writePhoto.bind(stage), writeStack: stage.writeStack.bind(stage),
				writeSavedCollection: stage.writeSavedCollection.bind(stage), writeDevelopPresets: stage.writeDevelopPresets.bind(stage),
				publish: stage.publish.bind(stage), rollback: stage.rollback.bind(stage) });
			stage = target; const identities = new PhotoCatalogArchiveIdentityLedger(), photos = new PhotoCatalogArchiveIdentityGuard(document.catalog, identities);
			const saved = new PhotoCatalogArchiveSavedCollectionGuardV3(document.catalog, document.savedCollectionState);
			const assets = new Map(envelope.manifest.assets.map(asset => [asset.sourceId, asset]));
			for (const pack of document.packs) {
				const entry = envelope.entryByName.get(pack.entry), asset = assets.get(pack.id);
				if (!entry || !asset) throw new Error('Photo archive pack is unavailable.');
				const count = await readPhotoCatalogPackEntryV1(entry, asset, envelope.expandedByteBudget, async (photo, original) => {
					photos.admit(photo); await target.writePhoto(photo, original);
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
				await readPhotoDevelopPresetPackEntryV1(entry, asset, envelope.expandedByteBudget, document.catalog.id, async row => {
					if (row.revision !== pack.revision || row.presets.length !== pack.presetCount) throw new Error('Develop preset row differs from its archive header.');
					await target.writeDevelopPresets(row);
				}, signal);
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
		if (!published && stage && typeof stage.rollback === 'function') {
			try { await stage.rollback(); } catch (failure) { cleanup.push(failure); }
		}
		const observed = signal !== undefined && Reflect.apply(nativeAborted, signal, []) === true
			&& Object.is(error, Reflect.apply(nativeReason, signal, []));
		throw aggregateScapeErrors(error, cleanup, 'Photo preset archive import and rollback failed.', observed ? { primaryIsAbort: true } : undefined);
	}
}

function admitArchive(parsed: unknown, manifest: ScapeManifest): PhotoCatalogArchiveDocumentV4 {
	const value = readClosedDomainRecord(parsed, 'catalog archive identity', ['schemaFamily', 'schemaVersion', 'kind', 'id', 'title',
		'catalog', 'packs', 'stackCount', 'stackPacks', 'savedCollectionState', 'savedCollectionPacks', 'developPresetPack'], ['schemaFamily', 'schemaVersion']);
	const version = readClosedDomainField(value, 'schemaVersion', 'catalog archive identity');
	const document = version === 1 ? normalizePhotoCatalogArchiveV1(parsed)
		: version === 2 ? normalizePhotoCatalogArchiveV2(parsed) : version === 3 ? normalizePhotoCatalogArchiveV3(parsed) : normalizePhotoCatalogArchiveV4(parsed);
	if (manifest.project.schemaFamily !== 'lightscaper' || manifest.project.schemaVersion !== document.schemaVersion) {
		throw new TypeError('Archive manifest schema differs from its document.');
	}
	if (document.schemaVersion === 4) { assertPhotoCatalogPackManifestV4(document, manifest); return document; }
	if (document.schemaVersion === 3) { assertPhotoCatalogPackManifestV3(document, manifest); return Object.freeze({ ...document, schemaVersion: 4, developPresetPack: null }); }
	if (document.schemaVersion === 1) {
		assertPhotoCatalogPackManifestV1(document, manifest);
		return Object.freeze({ ...document, schemaVersion: 4, developPresetPack: null, stackCount: 0, stackPacks: Object.freeze([]),
			savedCollectionState: null, savedCollectionPacks: Object.freeze([]) });
	}
	assertPhotoCatalogPackManifestV2(document, manifest);
	return Object.freeze({ ...document, schemaVersion: 4, developPresetPack: null, savedCollectionState: null, savedCollectionPacks: Object.freeze([]) });
}

const nativeAbort = AbortSignal.prototype.throwIfAborted;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
function checkSignal(signal?: AbortSignal): void { if (signal) Reflect.apply(nativeAbort, signal, []); }
