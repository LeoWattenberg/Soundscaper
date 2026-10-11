/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopSettingsV2 } from '../../common/editor/photo-library-develop-port-v2.ts';
import { FRAMESCAPER_IMAGE_MODEL_LIMITS_V1 as LIMITS } from '../../common/editor/timeline-image-model.ts';
import { planImageDevelopMasksV1 } from '../../common/editor/imaging/image-develop-mask-plan-v1.ts';

const PIXEL_LIMITS = Object.freeze({ maximumSidePixels: LIMITS.maximumDimension,
	maximumPixels: LIMITS.maximumPixelsPerFrame, maximumBytes: LIMITS.maximumPixelsPerFrame * 4 });

/** Admit portable masks against the receiving renderer before reading bodies. */
export function assertPhotoDevelopHandoffMasksV1(develop: PhotoLibraryDevelopSettingsV2, width: number, height: number): void {
	planImageDevelopMasksV1(develop, width, height, PIXEL_LIMITS);
}
