/* SPDX-License-Identifier: AGPL-3.0-only */

import { aggregateScapeErrors, throwIfScapeAborted } from '../../common/editor/scape-abort.ts';
import { readScapeArchiveEnvelope } from '../../common/editor/scape-archive-envelope.ts';
import { verifyScapeAssetBytes } from '../../common/editor/scape-archive-media.ts';
import { withScapeProjectInput, type ScapeProjectInput, type ScapeProjectInputReaderFactories } from '../../common/editor/scape-project-input.ts';
import { parseOpaqueScapeProjectDocument } from '../../common/editor/scape-project-document.ts';
import type { PhotoCatalogRootV1, PhotoDocumentV1 } from '../catalog/types.ts';
import { PHOTO_CATALOG_ARCHIVE_LIMITS_V1 as LIMITS, PhotoCatalogArchiveIdentityGuard, assertPhotoCatalogPackManifestV1, normalizePhotoCatalogArchiveV1 } from './catalog-archive-contract.ts';
import { readPhotoCatalogPackEntryV1 } from './catalog-pack-entry.ts';

/** Trusted provisional sink: no row or original becomes visible before publish. */
export interface PhotoCatalogArchiveStageV1 {
	writePhoto(photo: PhotoDocumentV1, original: AsyncIterable<Uint8Array>): Promise<void>;
	publish(): Promise<void>;
	rollback(): Promise<void>;
}

export async function importPhotoCatalogArchiveV1(
	input: ScapeProjectInput,
	createStage: (root: PhotoCatalogRootV1) => Promise<PhotoCatalogArchiveStageV1>,
	options: Readonly<{ signal?: AbortSignal; readerFactories?: ScapeProjectInputReaderFactories }> = {},
): Promise<PhotoCatalogRootV1> {
	if (typeof createStage !== 'function') throw new TypeError('A provisional photo catalog destination is required.');
	const signal = options.signal;
	let stage: PhotoCatalogArchiveStageV1 | undefined;
	try {
		const root = await withScapeProjectInput(input, signal, async (entries) => {
			const envelope = await readScapeArchiveEnvelope(entries, { maximumProjectBytes: LIMITS.maximumDocumentBytes }, signal);
			verifyScapeAssetBytes(new TextEncoder().encode(envelope.projectText), envelope.manifest.project, 'photo catalog document');
			const document = normalizePhotoCatalogArchiveV1(parseOpaqueScapeProjectDocument(envelope.projectText));
			assertPhotoCatalogPackManifestV1(document, envelope.manifest);
			throwIfScapeAborted(signal);
			stage = await createStage(document.catalog);
			if (!stage || typeof stage.writePhoto !== 'function' || typeof stage.publish !== 'function' || typeof stage.rollback !== 'function') throw new TypeError('Photo catalog stage is incomplete.');
			const target = stage;
			const identity = new PhotoCatalogArchiveIdentityGuard(document.catalog);
			const assets = new Map(envelope.manifest.assets.map((asset) => [asset.sourceId, asset]));
			for (const pack of document.packs) {
				const entry = envelope.entryByName.get(pack.entry);
				const asset = assets.get(pack.id);
				if (!entry || !asset) throw new Error('Photo archive pack is unavailable.');
				const count = await readPhotoCatalogPackEntryV1(entry, asset, envelope.expandedByteBudget, async (photo, original) => {
					identity.admit(photo);
					await target.writePhoto(photo, original);
				}, signal);
				if (count !== pack.photoCount) throw new RangeError('Photo archive pack differs from its declared record count.');
			}
			if (identity.count !== document.catalog.photoCount) throw new RangeError('Photo archive differs from its declared catalog count.');
			return document.catalog;
		}, options.readerFactories);
		// Reader cleanup must succeed before the only publication boundary.
		throwIfScapeAborted(signal);
		if (!stage) throw new Error('Photo catalog stage was not prepared.');
		await stage.publish();
		return root;
	} catch (error) {
		const cleanup: unknown[] = [];
		if (stage && typeof stage.rollback === 'function') {
			try { await stage.rollback(); } catch (failure) { cleanup.push(failure); }
		}
		throw aggregateScapeErrors(error, cleanup, 'Photo archive import and rollback failed.');
	}
}
