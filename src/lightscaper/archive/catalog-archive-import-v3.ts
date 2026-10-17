/* SPDX-License-Identifier: AGPL-3.0-only */

import { aggregateScapeErrors, throwIfScapeAborted } from '../../common/editor/scape-abort.ts';
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
import { assertPhotoCatalogPackManifestV3, normalizePhotoCatalogArchiveV3, type PhotoCatalogArchiveDocumentV3 } from './catalog-archive-contract-v3.ts';
import { PhotoCatalogArchiveIdentityLedger } from './catalog-archive-identities.ts';
import type { PhotoCatalogArchiveStageV2 } from './catalog-archive-import-v2.ts';
import { PhotoCatalogArchiveSavedCollectionGuardV3 } from './catalog-archive-saved-collection-guard-v3.ts';
import { readPhotoCatalogPackEntryV1 } from './catalog-pack-entry.ts';
import { readPhotoStackPackEntryV1 } from './stack-pack-entry.ts';
import { readPhotoSmartCollectionPackEntryV1 } from './smart-collection-pack-entry-v1.ts';

/** All borrowed writes remain provisional; fulfilled publish is the destination's durable ACK. */
export interface PhotoCatalogArchiveStageV3 extends PhotoCatalogArchiveStageV2 {
	writeSavedCollection(definition: PhotoSmartCollectionV1): Promise<void>;
}
export type PhotoCatalogArchiveStageFactoryV3 = (root: PhotoCatalogRootV1,
	savedCollectionState: Readonly<PhotoSmartCollectionsStateV1> | null) => Promise<PhotoCatalogArchiveStageV3>;

/** Preserve archived values; this codec neither remaps identities nor owns a database/writer. */
export async function importPhotoCatalogArchiveV3(input: ScapeProjectInput, createStage: PhotoCatalogArchiveStageFactoryV3,
	options: Readonly<{ signal?: AbortSignal; readerFactories?: ScapeProjectInputReaderFactories }> = {}): Promise<PhotoCatalogRootV1> {
	if (typeof createStage !== 'function') throw new TypeError('A provisional photo catalog destination is required.');
	const signal = options.signal; let stage: PhotoCatalogArchiveStageV3 | undefined, published = false;
	try {
		const root = await withScapeProjectInput(input, signal, async entries => {
			const envelope = await readScapeArchiveEnvelope(entries, { maximumProjectBytes: LIMITS.maximumDocumentBytes }, signal);
			verifyScapeAssetBytes(new TextEncoder().encode(envelope.projectText), envelope.manifest.project, 'photo catalog document');
			const document = admitArchive(parseOpaqueScapeProjectDocument(envelope.projectText), envelope.manifest);
			throwIfScapeAborted(signal); stage = await createStage(document.catalog, document.savedCollectionState);
			if (!stage || typeof stage.writePhoto !== 'function' || typeof stage.writeStack !== 'function'
				|| typeof stage.writeSavedCollection !== 'function' || typeof stage.publish !== 'function' || typeof stage.rollback !== 'function') {
				throw new TypeError('Photo catalog saved collection stage is incomplete.');
			}
			throwIfScapeAborted(signal);
			const target = stage, identities = new PhotoCatalogArchiveIdentityLedger(), photos = new PhotoCatalogArchiveIdentityGuard(document.catalog, identities);
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
			saved.finish(); return document.catalog;
		}, options.readerFactories);
		// Authentication, decoder/extractor joining and ZIP reader closure precede publication.
		throwIfScapeAborted(signal); if (!stage) throw new Error('Photo catalog stage was not prepared.');
		await stage.publish(); published = true;
		// No cancellation probe follows the known publication ACK.
		return root;
	} catch (error) {
		const cleanup: unknown[] = [];
		if (!published && stage && typeof stage.rollback === 'function') {
			try { await stage.rollback(); } catch (failure) { cleanup.push(failure); }
		}
		throw aggregateScapeErrors(error, cleanup, 'Photo saved collection archive import and rollback failed.');
	}
}

function admitArchive(parsed: unknown, manifest: ScapeManifest): PhotoCatalogArchiveDocumentV3 {
	const value = readClosedDomainRecord(parsed, 'catalog archive identity', ['schemaFamily', 'schemaVersion', 'kind', 'id', 'title',
		'catalog', 'packs', 'stackCount', 'stackPacks', 'savedCollectionState', 'savedCollectionPacks'], ['schemaFamily', 'schemaVersion']);
	const version = readClosedDomainField(value, 'schemaVersion', 'catalog archive identity');
	const document = version === 1 ? normalizePhotoCatalogArchiveV1(parsed)
		: version === 2 ? normalizePhotoCatalogArchiveV2(parsed) : normalizePhotoCatalogArchiveV3(parsed);
	if (manifest.project.schemaFamily !== 'lightscaper' || manifest.project.schemaVersion !== document.schemaVersion) {
		throw new TypeError('Archive manifest schema differs from its document.');
	}
	if (document.schemaVersion === 3) { assertPhotoCatalogPackManifestV3(document, manifest); return document; }
	if (document.schemaVersion === 1) {
		assertPhotoCatalogPackManifestV1(document, manifest);
		return Object.freeze({ ...document, schemaVersion: 3, stackCount: 0, stackPacks: Object.freeze([]),
			savedCollectionState: null, savedCollectionPacks: Object.freeze([]) });
	}
	assertPhotoCatalogPackManifestV2(document, manifest);
	return Object.freeze({ ...document, schemaVersion: 3, savedCollectionState: null, savedCollectionPacks: Object.freeze([]) });
}
