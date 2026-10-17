/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PixelFrameV1 } from '../../../imaging/pixel-frame-contract-v1.ts';
import type { PhotoDevelopPresentationViewKernelV1, PhotoDevelopPresentationPortsKernelV1 } from './photo-library-develop-presentation-kernel-v1.ts';
import type { PhotoDevelopPresentationSnapshotV2 } from '../photo-library-develop-presentation-v2.ts';
import type { ImageDevelopMaskOverlayViewV1 } from '../../../imaging/image-develop-mask-overlay-v1.ts';
import { withImageOutputSoftProofCurrentV1 } from '../../../imaging/image-output-soft-proof-current-v1.ts';
import { withPhotoDevelopDisplayFrameCurrentV1 } from '../../../imaging/photo-develop-display-frame-current-v1.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../../../photo-library-develop-full-resolution-port-v1.ts';
import { checkRepairSignalV1 } from '../../../imaging/pixel-frame-repair-lifetime-v1.ts';

type Rendered = Pick<PhotoDevelopPresentationSnapshotV2, 'before' | 'after' | 'extent'>;
type Original = Readonly<{ histogram: NonNullable<Rendered['before']>; extent: Readonly<{ width: number; height: number }> }>;

/** One final target conversion for either byte or native Current output. The
 * saved recipe and canonical Before never acquire this presentation policy. */
export async function presentPhotoDevelopProofAfterCurrentV1(view: Readonly<PhotoDevelopPresentationViewKernelV1>,
	output: Readonly<{ frame: PixelFrameV1; maskOverlay?: Readonly<ImageDevelopMaskOverlayViewV1> }>, signal: AbortSignal,
	paint: NonNullable<PhotoDevelopPresentationPortsKernelV1['paint']>, current: () => boolean, original: Original): Promise<Rendered | null> {
	if (!view.softProof) throw new TypeError('Output proof requires its captured policy.');
	return withImageOutputSoftProofCurrentV1({ frame: output.frame, softProof: view.softProof, signal }, proof =>
		withPhotoDevelopDisplayFrameCurrentV1({ frame: proof.frame, signal,
			...(view.maskOverlay ? { maskOverlay: output.maskOverlay, maskOverlayMode: view.maskOverlayMode } : {}) }, display => {
			checkRepairSignalV1(signal); if (!current()) return null;
			paint(view.after, display.frame, { limits: PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1.render, signal }); checkRepairSignalV1(signal);
			if (display.overlay && view.overlay) { paint(view.overlay, display.overlay, { limits: PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1.render, signal }); checkRepairSignalV1(signal); }
			return Object.freeze({ before: original.histogram, after: proof.histogram, extent: Object.freeze({ before: original.extent,
				after: Object.freeze({ width: display.frame.descriptor.width, height: display.frame.descriptor.height }) }) });
		}, view.resolution ?? 'proxy'), 'full');
}
