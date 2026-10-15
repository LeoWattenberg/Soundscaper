/* SPDX-License-Identifier: AGPL-3.0-only */

import { withImageExifContainerForProfileV1 } from './image-exif-container-kernel-v1.ts';
export type { ImageExifContainerInputV1, ImageExifContainerOptionsV1 } from './image-exif-container-kernel-v1.ts';

/** Current codec profile adds RGBA PNG16; JPEG admission and scoped custody stay identical. */
export function withImageExifContainerCurrentV1<T>(value: unknown,
	consume: (bytes: Uint8Array<ArrayBuffer>) => T | PromiseLike<T>, optionsValue: unknown = {}): Promise<T> {
	return withImageExifContainerForProfileV1('current1', value, consume, optionsValue);
}
