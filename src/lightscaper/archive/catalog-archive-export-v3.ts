/* SPDX-License-Identifier: AGPL-3.0-only */

import { aggregateScapeErrors } from '../../common/editor/scape-abort.ts';
import { PHOTO_STACK_PACK_ASSET_KIND, PHOTO_STACK_PACK_ENCODING } from '../../common/editor/scape-photo-stack-pack.ts';
import { PHOTO_SMART_COLLECTION_PACK_ASSET_KIND, PHOTO_SMART_COLLECTION_PACK_ENCODING } from '../../common/editor/scape-photo-smart-collection-pack.ts';
import { readValidatedPhotoCatalogRootV1 } from '../catalog/documents.ts';
import { normalizePhotoSmartCollectionsStateV1 } from '../catalog/photo-smart-collection-state-v1.ts';
import type { PhotoSmartCollectionV1 } from '../catalog/photo-smart-collection-v1.ts';
import type { PhotoStackV1 } from '../catalog/photo-stack-v1.ts';
import { PhotoCatalogArchiveIdentityGuard } from './catalog-archive-contract.ts';
import { admitPhotoArchiveStackV2, type PhotoCatalogArchiveStackPackV2 } from './catalog-archive-contract-v2.ts';
import { normalizePhotoCatalogArchiveV3, serializePhotoCatalogArchiveV3,
	type PhotoCatalogArchiveDocumentV3, type PhotoCatalogArchiveSavedCollectionPackV3 } from './catalog-archive-contract-v3.ts';
import { PhotoCatalogArchiveIdentityLedger } from './catalog-archive-identities.ts';
import { PhotoCatalogArchiveSavedCollectionGuardV3 } from './catalog-archive-saved-collection-guard-v3.ts';
import { maximumPhotoCatalogStreamingOutputBytesV3 } from './catalog-archive-capacity.ts';
import { writePhotoCatalogArchive, type PhotoCatalogArchiveExportOptions, type PhotoCatalogArchiveWrittenResult } from './catalog-archive-writer.ts';
import type { PhotoCatalogPackInput } from './catalog-pack.ts';
import { encodePhotoStackPackV1 } from './stack-pack.ts';
import { PhotoStackPackSequence } from './stack-pack-sequence.ts';
import { encodePhotoSmartCollectionPackV1 } from './smart-collection-pack-v1.ts';
import { PhotoSmartCollectionPackSequence } from './smart-collection-pack-sequence-v1.ts';

export interface PhotoCatalogArchiveExportOptionsV3 extends PhotoCatalogArchiveExportOptions {
	/** Borrowed live sources settle their final inventory fence before output close. */
	readonly verifySource?: () => Promise<void>;
}
export type PhotoCatalogArchiveExportResultV3 = PhotoCatalogArchiveWrittenResult<PhotoCatalogArchiveDocumentV3>;

export async function exportPhotoCatalogArchiveV3(rootValue: unknown,
	photos: Iterable<PhotoCatalogPackInput> | AsyncIterable<PhotoCatalogPackInput>,
	stacks: Iterable<PhotoStackV1> | AsyncIterable<PhotoStackV1>, stateValue: unknown,
	definitions: Iterable<PhotoSmartCollectionV1> | AsyncIterable<PhotoSmartCollectionV1>,
	options: PhotoCatalogArchiveExportOptionsV3 = {}): Promise<PhotoCatalogArchiveExportResultV3> {
	const root = readValidatedPhotoCatalogRootV1(rootValue);
	const state = stateValue === null ? null : normalizePhotoSmartCollectionsStateV1(stateValue);
	const saved = new PhotoCatalogArchiveSavedCollectionGuardV3(root, state), identity = new PhotoCatalogArchiveIdentityLedger();
	const verifySource = options.verifySource;
	if (verifySource !== undefined && typeof verifySource !== 'function') throw new TypeError('A source verification callback is required.');
	return writePhotoCatalogArchive(root, photos, new PhotoCatalogArchiveIdentityGuard(root, identity), async (packs, writer) => {
		let stackSequence: PhotoStackPackSequence | undefined, savedSequence: PhotoSmartCollectionPackSequence | undefined;
		try {
			stackSequence = new PhotoStackPackSequence(stacks, value => { admitPhotoArchiveStackV2(value, root.id, identity); }, options.signal);
			const stackPacks: PhotoCatalogArchiveStackPackV2[] = []; let stackRecords = await stackSequence.nextPack();
			while (stackRecords) {
				const ordinal = String(stackPacks.length + 1).padStart(6, '0'), id = `stack-pack-${ordinal}`, entry = `assets/stack-pack-${ordinal}.bin`;
				let stackCount = 0;
				async function* counted() { for await (const stack of stackRecords!) { stackCount += 1; yield stack; } }
				await writer.addPack({ sourceId: id, entry, kind: PHOTO_STACK_PACK_ASSET_KIND, encoding: PHOTO_STACK_PACK_ENCODING }, encodePhotoStackPackV1(counted(), { signal: options.signal }));
				stackPacks.push(Object.freeze({ id, entry, stackCount })); stackRecords = await stackSequence.nextPack();
			}
			await stackSequence.close();
			savedSequence = new PhotoSmartCollectionPackSequence(definitions, value => { saved.admit(value); }, options.signal);
			const savedCollectionPacks: PhotoCatalogArchiveSavedCollectionPackV3[] = []; let savedRecords = await savedSequence.nextPack();
			while (savedRecords) {
				const ordinal = String(savedCollectionPacks.length + 1).padStart(6, '0'), id = `saved-collection-pack-${ordinal}`, entry = `assets/saved-collection-pack-${ordinal}.bin`;
				let collectionCount = 0;
				async function* counted() { for await (const definition of savedRecords!) { collectionCount += 1; yield definition; } }
				await writer.addPack({ sourceId: id, entry, kind: PHOTO_SMART_COLLECTION_PACK_ASSET_KIND, encoding: PHOTO_SMART_COLLECTION_PACK_ENCODING }, encodePhotoSmartCollectionPackV1(counted(), { signal: options.signal }));
				savedCollectionPacks.push(Object.freeze({ id, entry, collectionCount })); savedRecords = await savedSequence.nextPack();
			}
			await savedSequence.close(); saved.finish();
			const document = normalizePhotoCatalogArchiveV3({ schemaFamily: 'lightscaper', schemaVersion: 3, kind: 'photo-catalog-archive',
				id: root.id, title: root.name, catalog: root, packs, stackCount: identity.stackCount, stackPacks,
				savedCollectionState: state, savedCollectionPacks });
			return { document, text: serializePhotoCatalogArchiveV3(document), schemaVersion: 3, beforeFinish: verifySource };
		} catch (error) {
			const cleanup: unknown[] = [];
			for (const sequence of [savedSequence, stackSequence]) { try { await sequence?.close(); } catch (failure) { cleanup.push(failure); } }
			throw aggregateScapeErrors(error, cleanup, 'Saved catalog archive enumeration and cleanup failed.');
		}
	}, options, maximumPhotoCatalogStreamingOutputBytesV3());
}
