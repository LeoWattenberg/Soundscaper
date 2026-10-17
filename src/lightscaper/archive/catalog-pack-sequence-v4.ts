/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoCatalogPackSequence } from './catalog-pack-sequence-kernel.ts';
import { measurePhotoCatalogPackRecordV4, type PhotoCatalogPackInputV4 } from './catalog-pack-v4.ts';
import type { PhotoCatalogArchiveIdentityGuard } from './catalog-archive-contract.ts';

export class PhotoCatalogPackSequenceV4 extends PhotoCatalogPackSequence<'current3'> {
	constructor(source: Iterable<PhotoCatalogPackInputV4> | AsyncIterable<PhotoCatalogPackInputV4>, identity: PhotoCatalogArchiveIdentityGuard, signal?: AbortSignal) {
		super(source, identity, signal, measurePhotoCatalogPackRecordV4, 'current3');
	}
}
