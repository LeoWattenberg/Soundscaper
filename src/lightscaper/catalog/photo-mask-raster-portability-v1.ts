/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPhotoMaskRasterReachabilityV1 } from './photo-mask-raster-reachability-v1.ts';

/** Local brush identity/body custody is not portable archive authority. The
 * owning collector admits complete retained Photo state, including inactive
 * versions, history/redo, snapshots and every declared graph input. Reserved
 * malformed/future identities keep their resource owner's admission failure.
 * No body source, recipient or destination permission is acquired here. */
export function assertPhotoMaskRasterPortableV1(value: unknown): void {
	const closure = createPhotoMaskRasterReachabilityV1();
	closure.addPhoto(value);
	if (closure.finish().length) throw new TypeError('Brush mask resources require a portable body transport.');
}

/** Recipe boundaries use the same owning declaration traversal. Unrelated
 * graph inputs remain subject to the existing receiving-renderer admission. */
export function assertImageDevelopMaskRasterPortableV1(value: unknown): void {
	const closure = createPhotoMaskRasterReachabilityV1();
	closure.addDevelop(value);
	if (closure.finish().length) throw new TypeError('Brush mask resources require a portable body transport.');
}
