/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray } from './closed-domain-value.ts';
import { normalizeVideoEffectsV2 } from './video-effects-v2.ts';
import type { VideoEffectLeafV2 } from './video-effect-leaf-v2.ts';

/** Explicit successor context retains the exact discrete resource reference.
 * Each family owns admission; the curve owner independently refuses every
 * nonnumeric target, including null and disabled LUT references. */
export function normalizeContextVideoEffectsV2(value: unknown, name: string): readonly Readonly<VideoEffectLeafV2>[] {
	return normalizeVideoEffectsV2(readClosedDomainArray(value, name, 0, 4_096), name);
}
