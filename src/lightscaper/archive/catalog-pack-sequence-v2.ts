/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoCatalogPackSequence } from './catalog-pack-sequence-kernel.ts';
import { measurePhotoCatalogPackRecordV2, type PhotoCatalogPackInputV2 } from './catalog-pack-v2.ts';
import type { PhotoCatalogArchiveIdentityGuard } from './catalog-archive-contract.ts';

export class PhotoCatalogPackSequenceV2 extends PhotoCatalogPackSequence {
	constructor(source: Iterable<PhotoCatalogPackInputV2> | AsyncIterable<PhotoCatalogPackInputV2>, identity: PhotoCatalogArchiveIdentityGuard, signal?: AbortSignal) {
		super(source, identity, signal, measurePhotoCatalogPackRecordV2);
	}
}
