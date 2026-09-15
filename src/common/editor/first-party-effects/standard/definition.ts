/* SPDX-License-Identifier: AGPL-3.0-only */

import { isStandardFilterEffect, type StandardFilterEffectType } from './filters-definition.ts';
import { isStandardModulationEffect, type StandardModulationEffectType } from './modulation-definition.ts';

export type StandardEffectType = StandardFilterEffectType | StandardModulationEffectType | 'noise-gate' | 'multi-tap-delay';
export function isStandardEffect(type: string): type is StandardEffectType {
	return isStandardFilterEffect(type) || isStandardModulationEffect(type) || type === 'noise-gate' || type === 'multi-tap-delay';
}
