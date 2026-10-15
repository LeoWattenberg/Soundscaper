/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeImageDevelopStateThroughV4 } from './image-develop-state-v4.ts';
import { normalizeImageDevelopStateV3 } from './image-develop-state-v3.ts';
import type { ImageDevelopStateThroughV3 } from './image-develop-state-through-v3.ts';
import { assertRawRecoveryFrameAuthorityV1 } from '../raw/internal/raw-recovery-frame-authority-v1.ts';

/** A computational projection after source processing, never a saved recipe.
 * Existing kernels receive every repair, mask, geometry and effect group.
 * A noncanonical setting cannot be interpreted over arbitrary RGB pixels. */
export function prepareImageDevelopRawSourceCurrentV1(developValue: unknown, frameValue: unknown): Readonly<ImageDevelopStateThroughV3> {
	const develop = normalizeImageDevelopStateThroughV4(developValue);
	if (develop.processVersion !== 4) return develop;
	if (develop.rawDevelopment.mode !== 'canonical') {
		assertRawRecoveryFrameAuthorityV1(frameValue,
			develop.rawDevelopment.mode === 'headroom' ? 'linear-headroom-v1' : 'highlight-recovery-v1');
	}
	return normalizeImageDevelopStateV3({ processVersion: 3, effects: develop.effects, geometry: develop.geometry,
		masks: develop.masks, maskBindings: develop.maskBindings, repairs: develop.repairs });
}
