/* SPDX-License-Identifier: AGPL-3.0-only */

import { withImageExifContainerProfilePolicyCurrentV1, type ImageExifContainerInputV1 } from './image-exif-container-kernel-v1.ts';
export type { ImageExifContainerOptionsV1 } from './image-exif-container-kernel-v1.ts';

export interface ImageExifContainerProfileInputCurrentV1 extends ImageExifContainerInputV1 {
	readonly profile: 'srgb' | 'display-p3';
	readonly bitDepth: 8 | 16;
}

/** The selected PNG profile/depth must already describe its encoded samples.
 * Capture adds only fresh truthful TIFF facts; Strip keeps the validated codec
 * bytes exact. Display P3 is cICP[12,13,0,1], without any competing color chunk.
 * JPEG remains sRGB8 until an independently proved native ICC path exists. */
export function withImageExifContainerProfileCurrentV1<T>(value: unknown,
	consume: (bytes: Uint8Array<ArrayBuffer>) => T | PromiseLike<T>, optionsValue: unknown = {}): Promise<T> {
	return withImageExifContainerProfilePolicyCurrentV1(value, consume, optionsValue);
}
