/* SPDX-License-Identifier: AGPL-3.0-only */

import { withImageDevelopFrameV3, type ImageDevelopFrameOptionsV3 } from '../../common/editor/imaging/image-develop-frame-v3.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../../common/editor/photo-library-develop-full-resolution-port-v1.ts';
import { PHOTO_DEVELOP_PROXY_LIMITS_V1, type PhotoDevelopFrameViewV1 } from './photo-develop-frame-core.ts';

export type PhotoDevelopFrameOptionsV3 = ImageDevelopFrameOptionsV3;
export function withPhotoDevelopProxyFrameV3<Result>(value: unknown,
	consume: (view: Readonly<PhotoDevelopFrameViewV1>) => Result | Promise<Result>, options: PhotoDevelopFrameOptionsV3 = {}): Promise<Result> {
	return withImageDevelopFrameV3(value, consume, PHOTO_DEVELOP_PROXY_LIMITS_V1, options);
}
export function withPhotoDevelopFullResolutionFrameV3<Result>(value: unknown,
	consume: (view: Readonly<PhotoDevelopFrameViewV1>) => Result | Promise<Result>, options: PhotoDevelopFrameOptionsV3 = {}): Promise<Result> {
	return withImageDevelopFrameV3(value, consume, PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1, options);
}
