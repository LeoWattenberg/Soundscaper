/* SPDX-License-Identifier: AGPL-3.0-only */

import { withPhotoDevelopProxyFrameV1, type PhotoDevelopFrameViewV1 } from './photo-develop-frame-v1.ts';
export { PHOTO_DEVELOP_PROXY_LIMITS_V1 } from './photo-develop-frame-v1.ts';
export type PhotoDevelopProxyViewV1 = PhotoDevelopFrameViewV1;

/** Compatibility entrypoint; the owning pipeline selects its fixed proxy profile. */
export function withPhotoDevelopProxyV1<Result>(value: unknown,
	consume: (view: Readonly<PhotoDevelopProxyViewV1>) => Result | Promise<Result>): Promise<Result> {
	return withPhotoDevelopProxyFrameV1(value, consume);
}
