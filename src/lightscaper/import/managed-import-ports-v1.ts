/* SPDX-License-Identifier: AGPL-3.0-only */

import type { KeyValueRepository } from '../../common/editor/storage/key-value-repository.ts';
import type { MediaCatalogOriginalRepositoryV1 } from '../../common/editor/storage/media-catalog-original-repository.ts';
import type { MediaRepository } from '../../common/editor/storage/media-repository.ts';
import type { PhotoCatalogRepositoryV1 } from '../catalog/repository.ts';
import type { PhotoCatalogImportExclusiveV1 } from './catalog-write-lock-v1.ts';

/** Trusted ownership ports; inputs and durable state are validated separately. */
export interface PhotoManagedImportPortsV1 {
	readonly catalog: Pick<PhotoCatalogRepositoryV1, 'loadCatalog' | 'loadPhoto' | 'publishPhotos'>;
	readonly media: Readonly<{
		writeAsset: MediaRepository['writeAsset'];
		custody: Pick<MediaCatalogOriginalRepositoryV1, 'findDigestPage' | 'stage' | 'readPage' | 'promote' | 'releaseStaged'>;
	}>;
	readonly journal: Pick<KeyValueRepository, 'get' | 'putIfAbsent' | 'deleteIfCurrent'>;
	readonly createImportId?: () => string;
	readonly exclusive?: PhotoCatalogImportExclusiveV1;
}

export interface PhotoManagedImportReceiptV1 {
	readonly index: number;
	readonly photoId: string | null;
	readonly status: 'imported' | 'failed';
	readonly reusedOriginal: boolean;
	readonly message: string | null;
}
