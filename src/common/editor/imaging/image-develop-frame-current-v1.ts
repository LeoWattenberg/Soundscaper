/* SPDX-License-Identifier: AGPL-3.0-only */

import { withImageDevelopFrameFixedKernelV1, type ImageDevelopFrameOptionsV3 } from './image-develop-frame-v3.ts';
import type { ImageDevelopFrameProfile, ImageDevelopFrameViewV1 } from './image-develop-frame-core.ts';
import { captureImageDevelopRawRequestCurrentV1 } from './image-develop-raw-request-current-v1.ts';

/** Active byte composition: original-space repairs and authentic resource
 * stages remain shared; radial warps gain explicit Current coverage transport. */
export async function withImageDevelopFrameCurrentV1<Result>(value: unknown,
	consume: (view: Readonly<ImageDevelopFrameViewV1>) => Result | Promise<Result>, profile: ImageDevelopFrameProfile,
	options: ImageDevelopFrameOptionsV3 = {}): Promise<Result> {
	return withImageDevelopFrameFixedKernelV1(captureImageDevelopRawRequestCurrentV1(value), consume, profile, options, 'current');
}
