/* SPDX-License-Identifier: AGPL-3.0-only */

import { aggregateScapeErrors } from '../../common/editor/scape-abort.ts';
import { PHOTO_STACK_PACK_ASSET_KIND, PHOTO_STACK_PACK_ENCODING } from '../../common/editor/scape-photo-stack-pack.ts';
import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import type { PhotoStackV1 } from '../catalog/photo-stack-v1.ts';
import { PhotoCatalogArchiveIdentityGuard } from './catalog-archive-contract.ts';
import { PhotoCatalogArchiveIdentityLedger } from './catalog-archive-identities.ts';
import { admitPhotoArchiveStackV2, normalizePhotoCatalogArchiveV2, serializePhotoCatalogArchiveV2,
	type PhotoCatalogArchiveDocumentV2, type PhotoCatalogArchiveStackPackV2 } from './catalog-archive-contract-v2.ts';
import { writePhotoCatalogArchive, type PhotoCatalogArchiveExportOptions, type PhotoCatalogArchiveWrittenResult } from './catalog-archive-writer.ts';
import type { PhotoCatalogPackInput } from './catalog-pack.ts';
import { encodePhotoStackPackV1 } from './stack-pack.ts';
import { PhotoStackPackSequence } from './stack-pack-sequence.ts';

export type PhotoCatalogArchiveExportResultV2 = PhotoCatalogArchiveWrittenResult<PhotoCatalogArchiveDocumentV2>;

export async function exportPhotoCatalogArchiveV2(rootValue: unknown,
	photos: Iterable<PhotoCatalogPackInput> | AsyncIterable<PhotoCatalogPackInput>,
	stacks: Iterable<PhotoStackV1> | AsyncIterable<PhotoStackV1>, options: PhotoCatalogArchiveExportOptions = {}): Promise<PhotoCatalogArchiveExportResultV2> {
	const root = validateLightscaperDocumentV1(rootValue);
	if (root.kind !== 'photo-catalog') throw new TypeError('Photo archive export requires a catalog root.');
	const identity = new PhotoCatalogArchiveIdentityLedger();
	return writePhotoCatalogArchive(root, photos, new PhotoCatalogArchiveIdentityGuard(root, identity), async (packs, writer) => {
		let sequence: PhotoStackPackSequence | undefined;
		try {
			sequence = new PhotoStackPackSequence(stacks, stack => { admitPhotoArchiveStackV2(stack, root.id, identity); }, options.signal);
			const stackPacks: PhotoCatalogArchiveStackPackV2[] = []; let records = await sequence.nextPack();
			while (records) {
				const ordinal = String(stackPacks.length + 1).padStart(6, '0'), id = `stack-pack-${ordinal}`, entry = `assets/stack-pack-${ordinal}.bin`;
				let stackCount = 0;
				async function* counted() { for await (const stack of records!) { stackCount += 1; yield stack; } }
				await writer.addPack({ sourceId: id, entry, kind: PHOTO_STACK_PACK_ASSET_KIND, encoding: PHOTO_STACK_PACK_ENCODING }, encodePhotoStackPackV1(counted(), { signal: options.signal }));
				stackPacks.push(Object.freeze({ id, entry, stackCount })); records = await sequence.nextPack();
			}
			await sequence.close();
			const document = normalizePhotoCatalogArchiveV2({ schemaFamily: 'lightscaper', schemaVersion: 2, kind: 'photo-catalog-archive',
				id: root.id, title: root.name, catalog: root, packs, stackCount: identity.stackCount, stackPacks });
			return { document, text: serializePhotoCatalogArchiveV2(document), schemaVersion: 2 };
		} catch (error) {
			const cleanup: unknown[] = []; try { await sequence?.close(); } catch (failure) { cleanup.push(failure); }
			throw aggregateScapeErrors(error, cleanup, 'Stack archive enumeration and cleanup failed.');
		}
	}, options);
}
