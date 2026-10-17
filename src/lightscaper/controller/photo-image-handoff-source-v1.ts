/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperImageSourceV2 } from '../../common/editor/timeline-image-model-v2.ts';
import { createPhotoImageHandoffSourceForProfileV1, type PhotoImageHandoffSourceRequestV1 } from './internal/photo-image-handoff-model-kernel-v1.ts';
export type { PhotoImageHandoffSourceRequestV1 } from './internal/photo-image-handoff-model-kernel-v1.ts';
export interface PhotoImageHandoffSourceV1 { readonly source: Readonly<FramescaperImageSourceV2>; readonly body: Blob }
export function createPhotoImageHandoffSourceV1(value: PhotoImageHandoffSourceRequestV1): Promise<Readonly<PhotoImageHandoffSourceV1>> {
	return createPhotoImageHandoffSourceForProfileV1('legacy2', value) as Promise<Readonly<PhotoImageHandoffSourceV1>>;
}
