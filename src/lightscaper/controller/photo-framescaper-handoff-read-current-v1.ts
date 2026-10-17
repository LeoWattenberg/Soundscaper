/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditableSource as Source } from './internal/photo-image-handoff-model-kernel-v1.ts';
import type { CubeLutSourcePortV1 } from '../../common/editor/imaging/cube-lut-source-port-v1.ts';
import type { VideoCubeLutReferenceV1 } from '../../common/editor/video-color-cube-lut-v27.ts';
import type { BrushMaskResourceReferenceV1 } from '../../common/editor/imaging/brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from '../../common/editor/imaging/mask-raster-source-port-v1.ts';
import { withPhotoFramescaperHandoffReadForProfileV1, type PhotoFramescaperHandoffReadRequestV1 } from './internal/photo-framescaper-handoff-read-kernel-v1.ts';
export type { PhotoFramescaperHandoffReadRequestV1 } from './internal/photo-framescaper-handoff-read-kernel-v1.ts';
export interface PhotoFramescaperHandoffReadViewCurrentV1 { readonly schemaVersion: 2; readonly projectId: string; readonly projectRevision: number;
	readonly source: Readonly<Source>; readonly originalBlob: Blob; readonly canonicalFrameSha256: string;
	readonly lutReferences: readonly Readonly<VideoCubeLutReferenceV1>[]; readonly signal: AbortSignal; readonly withLutBytes: CubeLutSourcePortV1['withBytes']; readonly maskRasterReferences: readonly Readonly<BrushMaskResourceReferenceV1>[]; readonly withMaskRasterBytes: MaskRasterSourcePortV1['withBytes']; }
export function withPhotoFramescaperHandoffReadCurrentV1<Result>(request: Readonly<PhotoFramescaperHandoffReadRequestV1>, consume: (view: Readonly<PhotoFramescaperHandoffReadViewCurrentV1>) => Result | Promise<Result>): Promise<Result> {
	return withPhotoFramescaperHandoffReadForProfileV1('current3', request, view => consume(view as Readonly<PhotoFramescaperHandoffReadViewCurrentV1>));
}
