/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImageHandoffRequestV1, PhotoLibraryImageHandoffViewV1 } from './photo-library-image-handoff-port-v1.ts';
import type { CubeLutSourcePortV1 } from './imaging/cube-lut-source-port-v1.ts';
import type { VideoCubeLutReferenceV1 } from './video-color-cube-lut-v27.ts';

export interface PhotoLibraryCollectionHandoffRequestV1 {
	readonly catalogId: string; readonly collectionId: string; readonly scope: 'catalog' | 'saved-query';
	readonly expectedCatalogRevision: number;
	/** Required for separately saved Query2 definitions; absent for root collections. */
	readonly expectedDefinitionRevision?: number;
}
export interface PhotoLibraryCollectionHandoffPhotoV1 {
	readonly binding: Readonly<PhotoLibraryImageHandoffRequestV1>;
	readonly factsJson: string;
	readonly original: PhotoLibraryImageHandoffViewV1['original'];
}
export interface PhotoLibraryCollectionHandoffViewV1 {
	readonly schemaVersion: 1; readonly signal: AbortSignal;
	readonly collection: Readonly<{ catalogId: string; id: string; scope: 'catalog' | 'saved-query'; name: string;
		catalogRevision: number; indexRevision: number; definitionRevision: number | null; definitionJson: string }>;
	/** Every selected active version, in the definition's native uncollapsed query order. */
	readonly photos: readonly Readonly<PhotoLibraryCollectionHandoffPhotoV1>[];
	readonly lutReferences: readonly Readonly<VideoCubeLutReferenceV1>[];
	withOriginal<Result>(photoId: string, consume: (blob: Blob) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Result>;
	readonly withLutBytes: CubeLutSourcePortV1['withBytes'];
}
/** A single selected Session operation authenticates the entire collection
 * before delivery. No partial prefix, body persistence, renderer, project or
 * archive authority is granted. One original consumer and one LUT reader may
 * be active; both join before the final facts fence and retirement. The scoped
 * capabilities seal when the consumer settles and accept only their captured
 * signal (or no additional signal). Complete Photo history remains sender-owned.
 * Capture admission is distinct from a later generated-pack/archive budget. */
export interface PhotoLibraryCollectionHandoffPortV1 {
	withCapture<Result>(request: Readonly<PhotoLibraryCollectionHandoffRequestV1>,
		consume: (view: Readonly<PhotoLibraryCollectionHandoffViewV1>) => Result | Promise<Result>,
		options?: Readonly<{ signal?: AbortSignal }>): Promise<Result>;
}
