/* SPDX-License-Identifier: AGPL-3.0-only */

import { isStandardFilterEffect } from './filters-definition.ts';

/** Parameter descriptors and editors share the last editable step below
 * Nyquist; non-cutoff controls retain their owning definition's limits.
 */
export function standardEffectParamRange(
	type: string, name: string, range: readonly number[] | null | undefined,
	sampleRate: number, step: number | undefined,
): readonly number[] | null | undefined {
	const cutoff = isStandardFilterEffect(type) && name === 'frequency'
		|| type === 'noise-gate' && name === 'gateFrequency';
	if (!cutoff || !range || range.length < 2) return range;
	const rate = Number.isFinite(sampleRate) && sampleRate >= 8_000 && sampleRate <= 384_000 ? sampleRate : 48_000;
	const increment = typeof step === 'number' && Number.isFinite(step) && step > 0 ? step : .1;
	const maximum = Number(((Math.ceil(rate / 2 / increment) - 1) * increment).toPrecision(12));
	return [range[0]!, Math.min(range[1]!, maximum)];
}
