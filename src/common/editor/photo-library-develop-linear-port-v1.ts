/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopFrameRequestV3 } from './photo-library-develop-proxy-port-v3.ts';
import type { LinearWorkingPixelFrameV1 } from './imaging/image-develop-linear-frame-v1.ts';

/** Native working frames retain the full-resolution pixel/side limits while
 * charging sixteen bytes per RGBA pixel. The shared owner also bounds source
 * plus working output to 512 MiB before inspecting source samples. */
export const PHOTO_DEVELOP_LINEAR_LIMITS_V1 = Object.freeze({
	source: Object.freeze({ maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 268_435_456 }),
	render: Object.freeze({ maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 268_435_456 }),
});

/** Explicit linear working delivery, separate from byte previews and exports.
 * No canvas overlay, transfer conversion or implicit byte fallback is offered. */
export interface PhotoLibraryDevelopLinearRuntimeV1 {
	withLinearWorkingFrame<Result>(request: Readonly<Omit<PhotoLibraryDevelopFrameRequestV3, 'maskOverlay'>>,
		consume: (frame: Readonly<LinearWorkingPixelFrameV1>) => Result | Promise<Result>): Promise<Result>;
}
