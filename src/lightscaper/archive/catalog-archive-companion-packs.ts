/* SPDX-License-Identifier: AGPL-3.0-only */

import { aggregateScapeErrors } from '../../common/editor/scape-abort.ts';
import { PHOTO_STACK_PACK_ASSET_KIND, PHOTO_STACK_PACK_ENCODING } from '../../common/editor/scape-photo-stack-pack.ts';
import { PHOTO_SMART_COLLECTION_PACK_ASSET_KIND, PHOTO_SMART_COLLECTION_PACK_ENCODING } from '../../common/editor/scape-photo-smart-collection-pack.ts';
import type { PhotoCatalogRootV1 } from '../catalog/types.ts';
import type { PhotoSmartCollectionsStateV1 } from '../catalog/photo-smart-collection-state-v1.ts';
import type { PhotoSmartCollectionV1 } from '../catalog/photo-smart-collection-v1.ts';
import type { PhotoStackV1 } from '../catalog/photo-stack-v1.ts';
import { admitPhotoArchiveStackV2, type PhotoCatalogArchiveStackPackV2 } from './catalog-archive-contract-v2.ts';
import type { PhotoCatalogArchiveSavedCollectionPackV3 } from './catalog-archive-contract-v3.ts';
import type { PhotoCatalogArchiveIdentityLedger } from './catalog-archive-identities.ts';
import { PhotoCatalogArchiveSavedCollectionGuardV3 } from './catalog-archive-saved-collection-guard-v3.ts';
import type { PhotoCatalogArchivePackWriter } from './catalog-archive-writer.ts';
import { encodePhotoStackPackV1 } from './stack-pack.ts';
import { PhotoStackPackSequence } from './stack-pack-sequence.ts';
import { encodePhotoSmartCollectionPackV1 } from './smart-collection-pack-v1.ts';
import { PhotoSmartCollectionPackSequence } from './smart-collection-pack-sequence-v1.ts';
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;

/** Closed V3 companion contracts are reused unchanged by V3 and V4 documents. Admission precedes photo IO. */
export function createPhotoCatalogCompanionWriter(root: PhotoCatalogRootV1,
	stacks: Iterable<PhotoStackV1> | AsyncIterable<PhotoStackV1>, state: PhotoSmartCollectionsStateV1 | null,
	definitions: Iterable<PhotoSmartCollectionV1> | AsyncIterable<PhotoSmartCollectionV1>,
	identity: PhotoCatalogArchiveIdentityLedger, signal?: AbortSignal) {
	const saved = new PhotoCatalogArchiveSavedCollectionGuardV3(root, state);
	return async (writer: PhotoCatalogArchivePackWriter) => {
		let stackSequence: PhotoStackPackSequence | undefined, savedSequence: PhotoSmartCollectionPackSequence | undefined;
		try {
			stackSequence = new PhotoStackPackSequence(stacks, value => { admitPhotoArchiveStackV2(value, root.id, identity); }, signal);
			const stackPacks: PhotoCatalogArchiveStackPackV2[] = []; let stackRecords = await stackSequence.nextPack();
			while (stackRecords) {
				const ordinal = String(stackPacks.length + 1).padStart(6, '0'), id = `stack-pack-${ordinal}`, entry = `assets/stack-pack-${ordinal}.bin`;
				let stackCount = 0;
				async function* counted() { for await (const stack of stackRecords!) { stackCount += 1; yield stack; } }
				await writer.addPack({ sourceId: id, entry, kind: PHOTO_STACK_PACK_ASSET_KIND, encoding: PHOTO_STACK_PACK_ENCODING }, encodePhotoStackPackV1(counted(), { signal }));
				stackPacks.push(Object.freeze({ id, entry, stackCount })); stackRecords = await stackSequence.nextPack();
			}
			await stackSequence.close();
			savedSequence = new PhotoSmartCollectionPackSequence(definitions, value => { saved.admit(value); }, signal);
			const savedCollectionPacks: PhotoCatalogArchiveSavedCollectionPackV3[] = []; let savedRecords = await savedSequence.nextPack();
			while (savedRecords) {
				const ordinal = String(savedCollectionPacks.length + 1).padStart(6, '0'), id = `saved-collection-pack-${ordinal}`, entry = `assets/saved-collection-pack-${ordinal}.bin`;
				let collectionCount = 0;
				async function* counted() { for await (const definition of savedRecords!) { collectionCount += 1; yield definition; } }
				await writer.addPack({ sourceId: id, entry, kind: PHOTO_SMART_COLLECTION_PACK_ASSET_KIND, encoding: PHOTO_SMART_COLLECTION_PACK_ENCODING }, encodePhotoSmartCollectionPackV1(counted(), { signal }));
				savedCollectionPacks.push(Object.freeze({ id, entry, collectionCount })); savedRecords = await savedSequence.nextPack();
			}
			await savedSequence.close(); saved.finish();
			return { stackCount: identity.stackCount, stackPacks, savedCollectionState: state, savedCollectionPacks };
		} catch (error) {
			const cleanup: unknown[] = [];
			for (const sequence of [savedSequence, stackSequence]) { try { await sequence?.close(); } catch (failure) { cleanup.push(failure); } }
			const observedAbort = signal !== undefined && Reflect.apply(nativeAborted, signal, []) === true
				&& Object.is(error, Reflect.apply(nativeReason, signal, []));
			throw aggregateScapeErrors(error, cleanup, 'Saved catalog archive enumeration and cleanup failed.',
				observedAbort ? { primaryIsAbort: true } : undefined);
		}
	};
}
