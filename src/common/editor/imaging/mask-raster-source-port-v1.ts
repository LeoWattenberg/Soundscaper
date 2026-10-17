/* SPDX-License-Identifier: AGPL-3.0-only */

import type { BrushMaskResourceReferenceV1 } from './brush-mask-resource-v1.ts';

/** Selected immutable body authority. The consumer and source cleanup remain
 * joined; callers independently authenticate complete bytes before rendering. */
export interface MaskRasterSourcePortV1 {
	withBytes<Result>(reference: Readonly<BrushMaskResourceReferenceV1>,
		consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>,
		options?: Readonly<{ signal?: AbortSignal }>): Promise<Result>;
}
