/* SPDX-License-Identifier: AGPL-3.0-only */

import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../../common/editor/photo-library-develop-full-resolution-port-v1.ts';
import { normalizePhotoDevelopV1 } from '../catalog/develop-state.ts';
import { withPhotoDevelopFrameCore, PHOTO_DEVELOP_PROXY_LIMITS_V1, type PhotoDevelopFrameViewV1 } from './photo-develop-frame-core.ts';
export { PHOTO_DEVELOP_PROXY_LIMITS_V1 } from './photo-develop-frame-core.ts';
export type { PhotoDevelopFrameViewV1 } from './photo-develop-frame-core.ts';

/** One already-oriented derivative under the unchanged strict process1 owner. */
export function withPhotoDevelopProxyFrameV1<Result>(value: unknown,
	consume: (view: Readonly<PhotoDevelopFrameViewV1>) => Result | Promise<Result>): Promise<Result> {
	return withPhotoDevelopFrameCore(value, consume, PHOTO_DEVELOP_PROXY_LIMITS_V1, { normalizeDevelop: normalizePhotoDevelopV1 });
}

/** Full-resolution inspection borrows the authenticated, already-oriented original. */
export function withPhotoDevelopFullResolutionFrameV1<Result>(value: unknown,
	consume: (view: Readonly<PhotoDevelopFrameViewV1>) => Result | Promise<Result>): Promise<Result> {
	return withPhotoDevelopFrameCore(value, consume, PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1, { normalizeDevelop: normalizePhotoDevelopV1 });
}
