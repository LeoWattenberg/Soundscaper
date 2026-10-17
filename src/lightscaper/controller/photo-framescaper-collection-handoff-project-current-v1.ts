/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPhotoFramescaperCollectionHandoffProjectForProfileV1, type PhotoFramescaperCollectionHandoffProjectIdentityV1 } from './internal/photo-framescaper-collection-handoff-project-kernel-v1.ts';
export type { PhotoFramescaperCollectionHandoffProjectIdentityV1 } from './internal/photo-framescaper-collection-handoff-project-kernel-v1.ts';
export function createPhotoFramescaperCollectionHandoffProjectCurrentV1(sources: unknown, identity: Readonly<PhotoFramescaperCollectionHandoffProjectIdentityV1>) {
	return createPhotoFramescaperCollectionHandoffProjectForProfileV1('current3', sources, identity);
}
