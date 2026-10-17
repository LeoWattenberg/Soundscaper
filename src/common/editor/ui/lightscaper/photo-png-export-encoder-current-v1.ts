/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoRasterExportRequestCurrentV1 } from '../../../../lightscaper/controller/photo-raster-export-contract-v1.ts';
import { encodePixelFramePngV1 } from '../../imaging/pixel-frame-png-v1.ts';

/** Capture depth in the export gesture; only the explicit deep codec is lazy. */
export const encodePhotoPngCurrentV1: PhotoRasterExportRequestCurrentV1['encode'] = (frame, options) => {
	const { bitDepth, profile, ...codecOptions } = options;
	if (profile !== undefined) return import('../../imaging/pixel-frame-png-profile-current-v1.ts')
		.then(module => module.encodePixelFramePngProfileCurrentV1(frame, { ...codecOptions, profile, bitDepth: bitDepth ?? 8 }));
	if (bitDepth === 16) return import('../../imaging/pixel-frame-png16-v1.ts').then(module => module.encodePixelFramePng16V1(frame, codecOptions));
	return encodePixelFramePngV1(frame, codecOptions);
};
