/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPhotoImageHandoffSourceForProfileV1, type PhotoImageHandoffSourceRequestV1, type PhotoImageHandoffSourceForProfileV1 } from './internal/photo-image-handoff-model-kernel-v1.ts';
export type PhotoImageHandoffSourceCurrentV1 = PhotoImageHandoffSourceForProfileV1;
export type PhotoImageHandoffSourceRequestCurrentV1 = PhotoImageHandoffSourceRequestV1;
export function createPhotoImageHandoffSourceCurrentV1(value: PhotoImageHandoffSourceRequestCurrentV1): Promise<Readonly<PhotoImageHandoffSourceCurrentV1>> { return createPhotoImageHandoffSourceForProfileV1('current3', value); }
