/* SPDX-License-Identifier: AGPL-3.0-only */

import { withImageExifContainerForProfileV1 } from './image-exif-container-kernel-v1.ts';
export { IMAGE_EXIF_CONTAINER_MAXIMUM_BYTES_V1 } from './image-exif-container-kernel-v1.ts';
export type { ImageExifContainerInputV1, ImageExifContainerOptionsV1 } from './image-exif-container-kernel-v1.ts';

/** Permanent codec profile: RGBA PNG8 and the admitted JPEG marker profile. */
export function withImageExifContainerV1<T>(value: unknown,
	consume: (bytes: Uint8Array<ArrayBuffer>) => T | PromiseLike<T>, optionsValue: unknown = {}): Promise<T> {
	return withImageExifContainerForProfileV1('legacy1', value, consume, optionsValue);
}
