/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoCatalogPackSequence } from './catalog-pack-sequence-kernel.ts';
import { measurePhotoCatalogPackRecordCurrentV1, type PhotoCatalogPackInputCurrentV1 } from './catalog-pack-current-v1.ts';
import type { PhotoCatalogArchiveIdentityGuard } from './catalog-archive-contract.ts';

export class PhotoCatalogPackSequenceCurrentV1 extends PhotoCatalogPackSequence<'current4'> {
	constructor(source: Iterable<PhotoCatalogPackInputCurrentV1> | AsyncIterable<PhotoCatalogPackInputCurrentV1>, identity: PhotoCatalogArchiveIdentityGuard, signal?: AbortSignal) {
		super(source, identity, signal, measurePhotoCatalogPackRecordCurrentV1, 'current4');
	}
}
