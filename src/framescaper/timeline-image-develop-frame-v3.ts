/* SPDX-License-Identifier: AGPL-3.0-only */
import { withFramescaperImageDevelopFrameForProfileV1 } from './internal/timeline-image-develop-frame-kernel-v1.ts';
import type { ImageDevelopFrameViewV1 } from '../common/editor/imaging/image-develop-frame-core.ts';
import type { ImageDevelopFrameOptionsV3 } from '../common/editor/imaging/image-develop-frame-v3.ts';

/** Source3 retains the exact authenticated Original pack and full editable recipe. */
export function withFramescaperImageDevelopFrameV3<Result>(value: unknown,
	consume: (view: Readonly<ImageDevelopFrameViewV1>) => Result | Promise<Result>, options: ImageDevelopFrameOptionsV3 = {}): Promise<Result> {
	return withFramescaperImageDevelopFrameForProfileV1('current3', value, consume, options);
}
