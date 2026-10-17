/* SPDX-License-Identifier: AGPL-3.0-only */

import { aggregateScapeErrors, throwIfScapeAborted } from '../../common/editor/scape-abort.ts';
import { readScapeArchiveEnvelope } from '../../common/editor/scape-archive-envelope.ts';
import { verifyScapeAssetBytes } from '../../common/editor/scape-archive-media.ts';
import { withScapeProjectInput, type ScapeProjectInput, type ScapeProjectInputReaderFactories } from '../../common/editor/scape-project-input.ts';
import { parseOpaqueScapeProjectDocument } from '../../common/editor/scape-project-document.ts';
import { readClosedDomainField, readClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import type { PhotoCatalogRootV1 } from '../catalog/types.ts';
import type { PhotoStackV1 } from '../catalog/photo-stack-v1.ts';
import { PHOTO_CATALOG_ARCHIVE_LIMITS_V1 as LIMITS, PhotoCatalogArchiveIdentityGuard, assertPhotoCatalogPackManifestV1, normalizePhotoCatalogArchiveV1 } from './catalog-archive-contract.ts';
import { admitPhotoArchiveStackV2, assertPhotoCatalogPackManifestV2, normalizePhotoCatalogArchiveV2 } from './catalog-archive-contract-v2.ts';
import { PhotoCatalogArchiveIdentityLedger } from './catalog-archive-identities.ts';
import type { PhotoCatalogArchiveStageV1 } from './catalog-archive-import.ts';
import { readPhotoCatalogPackEntryV1 } from './catalog-pack-entry.ts';
import { readPhotoStackPackEntryV1 } from './stack-pack-entry.ts';

/** Photos and stacks remain provisional until every reader and authentication settles. */
export interface PhotoCatalogArchiveStageV2 extends PhotoCatalogArchiveStageV1 { writeStack(stack: PhotoStackV1): Promise<void> }

export async function importPhotoCatalogArchiveV2(input: ScapeProjectInput,
	createStage: (root: PhotoCatalogRootV1) => Promise<PhotoCatalogArchiveStageV2>,
	options: Readonly<{ signal?: AbortSignal; readerFactories?: ScapeProjectInputReaderFactories }> = {}): Promise<PhotoCatalogRootV1> {
	if (typeof createStage !== 'function') throw new TypeError('A provisional photo catalog destination is required.');
	const signal = options.signal; let stage: PhotoCatalogArchiveStageV2 | undefined;
	try {
		const root = await withScapeProjectInput(input, signal, async entries => {
			const envelope = await readScapeArchiveEnvelope(entries, { maximumProjectBytes: LIMITS.maximumDocumentBytes }, signal);
			verifyScapeAssetBytes(new TextEncoder().encode(envelope.projectText), envelope.manifest.project, 'photo catalog document');
			const parsed = parseOpaqueScapeProjectDocument(envelope.projectText);
			const value = readClosedDomainRecord(parsed, 'catalog archive identity', ['schemaFamily', 'schemaVersion', 'kind', 'id', 'title', 'catalog', 'packs', 'stackCount', 'stackPacks'], ['schemaFamily', 'schemaVersion']);
			const version = readClosedDomainField(value, 'schemaVersion', 'catalog archive identity');
			const document = version === 1 ? normalizePhotoCatalogArchiveV1(parsed) : normalizePhotoCatalogArchiveV2(parsed);
			if (envelope.manifest.project.schemaFamily !== 'lightscaper' || envelope.manifest.project.schemaVersion !== document.schemaVersion) throw new TypeError('Archive manifest schema differs from its document.');
			if (document.schemaVersion === 1) assertPhotoCatalogPackManifestV1(document, envelope.manifest);
			else assertPhotoCatalogPackManifestV2(document, envelope.manifest);
			throwIfScapeAborted(signal); stage = await createStage(document.catalog);
			if (!stage || typeof stage.writePhoto !== 'function' || typeof stage.writeStack !== 'function' || typeof stage.publish !== 'function' || typeof stage.rollback !== 'function') throw new TypeError('Photo catalog stack stage is incomplete.');
			const target = stage, identities = new PhotoCatalogArchiveIdentityLedger(), photos = new PhotoCatalogArchiveIdentityGuard(document.catalog, identities);
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
			if (document.schemaVersion === 2) {
				for (const pack of document.stackPacks) {
					const entry = envelope.entryByName.get(pack.entry), asset = assets.get(pack.id);
					if (!entry || !asset) throw new Error('Stack archive pack is unavailable.');
					const count = await readPhotoStackPackEntryV1(entry, asset, envelope.expandedByteBudget, async stack => {
						admitPhotoArchiveStackV2(stack, document.catalog.id, identities); await target.writeStack(stack);
					}, signal);
					if (count !== pack.stackCount) throw new RangeError('Stack archive pack differs from its declared record count.');
				}
				if (identities.stackCount !== document.stackCount) throw new RangeError('Archive differs from its declared stack count.');
			}
			return document.catalog;
		}, options.readerFactories);
		throwIfScapeAborted(signal); if (!stage) throw new Error('Photo catalog stage was not prepared.');
		await stage.publish(); return root;
	} catch (error) {
		const cleanup: unknown[] = [];
		if (stage && typeof stage.rollback === 'function') { try { await stage.rollback(); } catch (failure) { cleanup.push(failure); } }
		throw aggregateScapeErrors(error, cleanup, 'Photo stack archive import and rollback failed.');
	}
}
