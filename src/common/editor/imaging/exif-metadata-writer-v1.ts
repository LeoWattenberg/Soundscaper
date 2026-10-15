/* SPDX-License-Identifier: AGPL-3.0-only */

import { encodeImageExifTiffForColorSpaceV1 } from './exif-metadata-writer-kernel-v1.ts';
export type { ImageExifWriteOptionsV1 } from './exif-metadata-writer-kernel-v1.ts';

/** Permanent upright sRGB TIFF metadata policy, without container framing. */
export function encodeImageExifTiffV1(value: unknown, options: unknown): Uint8Array<ArrayBuffer> | null {
	return encodeImageExifTiffForColorSpaceV1(1, value, options);
}
