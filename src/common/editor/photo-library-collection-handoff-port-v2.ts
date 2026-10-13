/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryCollectionHandoffRequestV1, PhotoLibraryCollectionHandoffViewV1 } from './photo-library-collection-handoff-port-v1.ts';
import type { PhotoLibraryImageHandoffRequestV2, PhotoLibraryImageHandoffViewV2 } from './photo-library-image-handoff-port-v2.ts';

export type PhotoLibraryCollectionHandoffRequestV2 = PhotoLibraryCollectionHandoffRequestV1;

export interface PhotoLibraryCollectionHandoffPhotoV2 {
	readonly binding: Readonly<PhotoLibraryImageHandoffRequestV2>;
	/** Exact SidecarCurrent: full Photo3 provenance survives a selected legacy recipe. */
	readonly factsJson: PhotoLibraryImageHandoffViewV2['factsJson'];
	readonly original: PhotoLibraryImageHandoffViewV2['original'];
}

export interface PhotoLibraryCollectionHandoffViewV2 extends Omit<PhotoLibraryCollectionHandoffViewV1, 'schemaVersion' | 'photos'> {
	readonly schemaVersion: 2;
	/** Every selected active version, in native uncollapsed query order. */
	readonly photos: readonly Readonly<PhotoLibraryCollectionHandoffPhotoV2>[];
	readonly maskRasterReferences: PhotoLibraryImageHandoffViewV2['maskRasterReferences'];
	readonly withMaskRasterBytes: PhotoLibraryImageHandoffViewV2['withMaskRasterBytes'];
}

/** One selected Current Session operation admits complete retained Photo facts,
 * namespaces and resource identities before authenticating any bodies. Every
 * retained resource is authenticated before Original acquisition or delivery.
 * The view transports only the union of complete selected recipes, including
 * disabled, unbound and unused declarations; history stays sender-owned.
 * Original consumers and the serial cross-kind LUT/brush reader remain scoped
 * to the captured signal. Admitted work joins before the final root, index,
 * definition, query-order and complete Photo fences and retirement. References
 * and saved facts grant no installation, archive or publication authority.
 * The permanent View1 route retains its independent strict legacy policy. */
export interface PhotoLibraryCollectionHandoffPortV2 {
	withCapture<Result>(request: Readonly<PhotoLibraryCollectionHandoffRequestV2>,
		consume: (view: Readonly<PhotoLibraryCollectionHandoffViewV2>) => Result | Promise<Result>,
		options?: Readonly<{ signal?: AbortSignal }>): Promise<Result>;
}
