/* SPDX-License-Identifier: AGPL-3.0-only */

import { standardDelayTailSeconds } from './delay-definition.ts';
import { isStandardFilterEffect, standardFilterTailSeconds } from './filters-definition.ts';
import { standardVocoderTailSeconds } from './modulation-definition.ts';
import { standardNoiseGateTailSeconds } from './noise-gate-definition.ts';

/** Startup-safe release contract; null delegates to other effect families. */
export function standardEffectTailSeconds(type: string, params: Readonly<Record<string, unknown>>, sampleRate: number): number | null {
	if (type === 'multi-tap-delay') return standardDelayTailSeconds(params);
	if (type === 'vocoder') return standardVocoderTailSeconds(params, sampleRate);
	if (type === 'noise-gate') return standardNoiseGateTailSeconds(params, sampleRate);
	if (isStandardFilterEffect(type)) return standardFilterTailSeconds(type, params, sampleRate);
	return type === 'tremolo' ? 0 : null;
}
