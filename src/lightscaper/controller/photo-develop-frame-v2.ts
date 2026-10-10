/* SPDX-License-Identifier: AGPL-3.0-only */

import { withImageDevelopFrameV2, type ImageDevelopFrameOptionsV2 } from '../../common/editor/imaging/image-develop-frame-v2.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../../common/editor/photo-library-develop-full-resolution-port-v1.ts';
import { PHOTO_DEVELOP_PROXY_LIMITS_V1, type PhotoDevelopFrameViewV1 } from './photo-develop-frame-core.ts';

export type PhotoDevelopFrameOptionsV2 = ImageDevelopFrameOptionsV2;

/** Compatibility entry points preserve the existing Photo profiles and resource admission. */
export function withPhotoDevelopProxyFrameV2<Result>(value: unknown,
	consume: (view: Readonly<PhotoDevelopFrameViewV1>) => Result | Promise<Result>, options: PhotoDevelopFrameOptionsV2 = {}): Promise<Result> {
	return withImageDevelopFrameV2(value, consume, PHOTO_DEVELOP_PROXY_LIMITS_V1, options);
}

export function withPhotoDevelopFullResolutionFrameV2<Result>(value: unknown,
	consume: (view: Readonly<PhotoDevelopFrameViewV1>) => Result | Promise<Result>, options: PhotoDevelopFrameOptionsV2 = {}): Promise<Result> {
	return withImageDevelopFrameV2(value, consume, PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1, options);
}
