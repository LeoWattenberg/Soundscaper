/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoDocumentV1 } from '../catalog/types.ts';
import type { PhotoDocumentV2 } from '../catalog/photo-document-v2.ts';
import { createPhotoFramescaperHandoffPhotoForProfileV1 } from './internal/photo-image-handoff-model-kernel-v1.ts';
export function createPhotoFramescaperHandoffPhotoV1(value: unknown): PhotoDocumentV1 | PhotoDocumentV2 { return createPhotoFramescaperHandoffPhotoForProfileV1('legacy2', value) as PhotoDocumentV1 | PhotoDocumentV2; }
