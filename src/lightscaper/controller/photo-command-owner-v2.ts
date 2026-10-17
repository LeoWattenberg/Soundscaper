/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoCatalogRepositoryV2 } from '../catalog/photo-catalog-repository-v2.ts';
import { PhotoCommandOwnerKernel, loadPhotoCommandRepositoryV1, type PhotoCommandOptionsKernel } from './photo-command-owner-kernel.ts';

export type PhotoCommandRepositoryPortV2 = Pick<PhotoCatalogRepositoryV2, 'loadPhoto' | 'savePhoto'>;
export type PhotoCommandOptionsV2 = PhotoCommandOptionsKernel;

/** Permanently fixed legacy2 scalar admission on the shared durable owner. */
export class PhotoCommandOwnerV2 extends PhotoCommandOwnerKernel<'legacy2'> {
	constructor(repository: PhotoCommandRepositoryPortV2, photo: unknown, capacity = 20) {
		super('legacy2', repository, photo, capacity);
	}
	static async open(repository: PhotoCommandRepositoryPortV2, catalogId: string, photoId: string, capacity = 20): Promise<PhotoCommandOwnerV2> {
		const opened = await loadPhotoCommandRepositoryV1<'legacy2'>(repository, catalogId, photoId);
		return new PhotoCommandOwnerV2(opened.repository, opened.photo, capacity);
	}
}
