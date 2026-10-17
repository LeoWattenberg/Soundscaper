/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import { createPhotoFramescaperHandoffPhotoForProfileV1 } from './internal/photo-image-handoff-model-kernel-v1.ts';
export function createPhotoFramescaperHandoffPhotoCurrentV1(value: unknown): PhotoDocumentCurrentV1 { return createPhotoFramescaperHandoffPhotoForProfileV1('current3', value); }
