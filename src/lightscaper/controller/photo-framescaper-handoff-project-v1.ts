/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPhotoFramescaperHandoffProjectForProfileV1, type PhotoFramescaperHandoffProjectIdentityV1 } from './internal/photo-image-handoff-model-kernel-v1.ts';
export type { PhotoFramescaperHandoffProjectIdentityV1 } from './internal/photo-image-handoff-model-kernel-v1.ts';
export function createPhotoFramescaperHandoffProjectV1(source: unknown, identity: Readonly<PhotoFramescaperHandoffProjectIdentityV1>) { return createPhotoFramescaperHandoffProjectForProfileV1('legacy2', source, identity); }
