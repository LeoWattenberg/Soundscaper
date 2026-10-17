/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImageHandoffRequestV1, PhotoLibraryImageHandoffViewV1 } from './photo-library-image-handoff-port-v1.ts';
import type { BrushMaskResourceReferenceV1 } from './imaging/brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from './imaging/mask-raster-source-port-v1.ts';

export type PhotoLibraryImageHandoffRequestV2 = PhotoLibraryImageHandoffRequestV1;
export interface PhotoLibraryImageHandoffViewV2 extends Omit<PhotoLibraryImageHandoffViewV1, 'schemaVersion'> {
	readonly schemaVersion: 2;
	readonly maskRasterReferences: readonly Readonly<BrushMaskResourceReferenceV1>[];
	readonly withMaskRasterBytes: MaskRasterSourcePortV1['withBytes'];
}
/** Authenticated Original and complete selected declarations are lent through
 * one serial cross-kind scoped borrower. All work joins before retirement;
 * factsJson is exact SidecarCurrent, never writer/installation authority. */
export interface PhotoLibraryImageHandoffPortV2 {
	withCapture<Result>(request: Readonly<PhotoLibraryImageHandoffRequestV2>,
		consume: (view: Readonly<PhotoLibraryImageHandoffViewV2>) => Result | Promise<Result>,
		options?: Readonly<{ signal?: AbortSignal }>): Promise<Result>;
}
