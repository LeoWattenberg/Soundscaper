/* SPDX-License-Identifier: AGPL-3.0-only */
import { withFramescaperImageDevelopFrameForProfileV1 } from './internal/timeline-image-develop-frame-kernel-v1.ts';
import type { ImageDevelopFrameViewV1 } from '../common/editor/imaging/image-develop-frame-core.ts';
import type { ImageDevelopFrameOptionsV2 } from '../common/editor/imaging/image-develop-frame-v2.ts';

/** Permanently strict Source2 frontdoor over the fixed shared pack/render owner. */
export function withFramescaperImageDevelopFrameV2<Result>(value: unknown,
	consume: (view: Readonly<ImageDevelopFrameViewV1>) => Result | Promise<Result>, options: ImageDevelopFrameOptionsV2 = {}): Promise<Result> {
	return withFramescaperImageDevelopFrameForProfileV1('legacy2', value, consume, options);
}
