/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoCommandOwnerKernel, loadPhotoCommandRepositoryV1, type PhotoCommandOptionsKernel,
	type PhotoCommandRepositoryForProfileV1 } from './photo-command-owner-kernel.ts';

export type PhotoCommandRepositoryPortCurrentV1 = PhotoCommandRepositoryForProfileV1<'current4'>;
export type PhotoCommandOptionsCurrentV1 = PhotoCommandOptionsKernel;

/** Explicit current4 admission; this owner does not activate a Session or UI. */
export class PhotoCommandOwnerCurrentV1 extends PhotoCommandOwnerKernel<'current4'> {
	constructor(repository: PhotoCommandRepositoryPortCurrentV1, photo: unknown, capacity = 20) {
		super('current4', repository, photo, capacity);
	}
	static async open(repository: PhotoCommandRepositoryPortCurrentV1, catalogId: string, photoId: string, capacity = 20): Promise<PhotoCommandOwnerCurrentV1> {
		const opened = await loadPhotoCommandRepositoryV1<'current4'>(repository, catalogId, photoId);
		return new PhotoCommandOwnerCurrentV1(opened.repository, opened.photo, capacity);
	}
}
