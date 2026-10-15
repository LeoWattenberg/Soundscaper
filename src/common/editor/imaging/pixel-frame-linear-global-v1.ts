/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray } from '../closed-domain-value.ts';
import { normalizeGlobalDevelopEffectV1, prepareGlobalDevelopEffectV1,
	type PreparedGlobalDevelopEffectV1 } from '../video-global-develop-v1.ts';

export interface PreparedLinearGlobalEffectV1 extends PreparedGlobalDevelopEffectV1 {
	readonly id: string;
}

const PREPARED = new WeakSet<object>();
const PIVOT = 0.18;

/** Admit the complete bounded recipe before a frame owner borrows any source samples.
 * Disabled and neutral stages still require the same closed metadata and unique IDs. */
export function prepareLinearGlobalEffectsV1(value: unknown): readonly Readonly<PreparedLinearGlobalEffectV1>[] {
	const effects = readClosedDomainArray(value, 'linear global develop effects', 0, 256)
		.map(effect => normalizeGlobalDevelopEffectV1(effect));
	const ids = new Set<string>();
	for (const effect of effects) {
		if (ids.has(effect.id)) throw new RangeError('Linear global develop effects require unique IDs.');
		ids.add(effect.id);
	}
	const prepared: Readonly<PreparedLinearGlobalEffectV1>[] = [];
	for (const effect of effects) {
		const global = prepareGlobalDevelopEffectV1(effect);
		if (!global.enabled || global.neutral) continue;
		const owned = Object.freeze({ id: effect.id, ...global });
		PREPARED.add(owned); prepared.push(owned);
	}
	return Object.freeze(prepared);
}

function smoothWeight(low: number, high: number, value: number): number {
	const weight = Math.max(0, Math.min(1, (value - low) / (high - low)));
	return weight * weight * (3 - 2 * weight);
}

/** Straight linear RGB only: no transfer conversion, sample clipping or quantization.
 * The frame owner preserves alpha and certifies each result before Float32 storage. */
export function linearGlobalDevelopChannelV1(effect: PreparedLinearGlobalEffectV1, value: number, channel: 0 | 1 | 2): number {
	if (!PREPARED.has(effect)) throw new TypeError('An owning prepared linear global effect is required.');
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Linear global develop requires a finite channel sample.');
	if (channel !== 0 && channel !== 1 && channel !== 2) throw new RangeError('Linear global develop requires an RGB channel.');
	const p = effect.params0, q = effect.params1;
	if (effect.type === 'white-balance-v1') return value * p[channel];
	// Keep exposure-only tiny samples intact instead of subtracting and re-adding the pivot.
	const exposed = value * p[0] * p[1] + PIVOT * (1 - p[1]);
	return exposed + p[2] * smoothWeight(0.5, 1, exposed) + p[3] * (1 - smoothWeight(0, 0.5, exposed))
		+ q[0] * smoothWeight(0.75, 1, exposed) + q[1] * (1 - smoothWeight(0, 0.25, exposed));
}
