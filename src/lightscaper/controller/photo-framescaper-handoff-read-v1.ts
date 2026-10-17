/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperImageSourceV2 as Source } from '../../common/editor/timeline-image-model-v2.ts';
import type { CubeLutSourcePortV1 } from '../../common/editor/imaging/cube-lut-source-port-v1.ts';
import type { VideoCubeLutReferenceV1 } from '../../common/editor/video-color-cube-lut-v27.ts';
import { withPhotoFramescaperHandoffReadForProfileV1, type PhotoFramescaperHandoffReadRequestV1 } from './internal/photo-framescaper-handoff-read-kernel-v1.ts';
export type { PhotoFramescaperHandoffReadRequestV1 } from './internal/photo-framescaper-handoff-read-kernel-v1.ts';
export interface PhotoFramescaperHandoffReadViewV1 { readonly schemaVersion: 1; readonly projectId: string; readonly projectRevision: number;
	readonly source: Readonly<Source>; readonly originalBlob: Blob; readonly canonicalFrameSha256: string;
	readonly lutReferences: readonly Readonly<VideoCubeLutReferenceV1>[]; readonly signal: AbortSignal; readonly withLutBytes: CubeLutSourcePortV1['withBytes'];  }
export function withPhotoFramescaperHandoffReadV1<Result>(request: Readonly<PhotoFramescaperHandoffReadRequestV1>, consume: (view: Readonly<PhotoFramescaperHandoffReadViewV1>) => Result | Promise<Result>): Promise<Result> {
	return withPhotoFramescaperHandoffReadForProfileV1('legacy2', request, view => consume(view as Readonly<PhotoFramescaperHandoffReadViewV1>));
}
