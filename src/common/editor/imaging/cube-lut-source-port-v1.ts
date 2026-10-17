/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoCubeLutReferenceV1 } from '../video-color-cube-lut-v27.ts';

/** A runtime resource capability, never a recipe parameter. Bytes are borrowed
 * through the joined consumer and source cleanup; the shared renderer still
 * authenticates their full digest and private parser independently of custody.
 * Closing a source repository does not replace observing this operation. */
export interface CubeLutSourcePortV1 {
	withBytes<Result>(reference: Readonly<VideoCubeLutReferenceV1>,
		consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>,
		options?: Readonly<{ signal?: AbortSignal }>): Promise<Result>;
}
