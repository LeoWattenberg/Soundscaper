/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoCatalogPackSequence } from './catalog-pack-sequence-kernel.ts';
import { measurePhotoCatalogPackRecordV3, type PhotoCatalogPackInputV3 } from './catalog-pack-v3.ts';
import type { PhotoCatalogArchiveIdentityGuard } from './catalog-archive-contract.ts';

export class PhotoCatalogPackSequenceV3 extends PhotoCatalogPackSequence {
	constructor(source: Iterable<PhotoCatalogPackInputV3> | AsyncIterable<PhotoCatalogPackInputV3>, identity: PhotoCatalogArchiveIdentityGuard, signal?: AbortSignal) {
		super(source, identity, signal, measurePhotoCatalogPackRecordV3);
	}
}
