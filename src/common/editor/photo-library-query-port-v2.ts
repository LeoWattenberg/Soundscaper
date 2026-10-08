/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoPredicateV2 } from '../../lightscaper/catalog/photo-smart-query-types-v2.ts';
import type { PHOTO_METADATA_QUERY_COLUMNS_V2 } from '../../lightscaper/catalog/photo-metadata-query-columns-v2.ts';
import type { PhotoLibraryQueryV1, PhotoLibraryQueryStepV1, PhotoLibraryQueryBuildProgressV1 } from './photo-library-session-port-v1.ts';

/** Versioned effective-metadata criteria; no original or develop document crosses this port. */
export interface PhotoLibraryQueryV2 extends PhotoLibraryQueryV1 {
	readonly schemaVersion: 2;
	readonly kind: 'photo-catalog-query';
	readonly predicate: PhotoPredicateV2 | null;
}

export interface PhotoLibraryQueryBuildProgressV2 extends PhotoLibraryQueryBuildProgressV1 {
	readonly writtenBytes: number;
}

export interface PhotoLibraryQueryPortV2 {
	readQueryStepV2(options: Readonly<{ query: PhotoLibraryQueryV2; cursor?: string | null; signal?: AbortSignal }>): Promise<PhotoLibraryQueryStepV1>;
	readStackQueryStepV2(options: Readonly<{ query: PhotoLibraryQueryV2; cursor?: string | null; signal?: AbortSignal }>): Promise<PhotoLibraryQueryStepV1>;
	rebuildQueryStepV2(options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryQueryBuildProgressV2>;
}

/** Product composition supplies these pure controls only when the menu opens. */
export interface PhotoMetadataQueryRuntimeV2 {
	readonly columns: typeof PHOTO_METADATA_QUERY_COLUMNS_V2;
	readonly normalizePredicate: (value: unknown) => PhotoPredicateV2;
}
export type LoadPhotoMetadataQueryRuntimeV2 = () => Promise<PhotoMetadataQueryRuntimeV2>;
