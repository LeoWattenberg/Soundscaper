/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField as field, readClosedDomainRecord } from './closed-domain-value.ts';
import { normalizeVideoEffects, videoEffectDefinition } from './video-effects.js';
import type { VideoEffectParameterV1 } from './video-curve-types-v1.ts';

export interface NormalizedContextVideoEffect {
	readonly id: string; readonly type: string; readonly enabled: boolean;
	readonly params: Readonly<Record<string, VideoEffectParameterV1>>;
}

/** Snapshot all registered parameters for context, while only numeric values may become keyframe targets.
 * The registry's owning point normalizer alone admits/detaches coordinate arrays. */
export function normalizeContextVideoEffects(value: unknown, name: string): readonly NormalizedContextVideoEffect[] {
	const effects = readClosedDomainArray(value, name, 0, 4_096);
	const snapshots = effects.map((candidate, index) => {
		const effectName = `${name}[${String(index)}]`;
		const effect = readClosedDomainRecord(candidate, effectName, ['id', 'type', 'enabled', 'params']);
		const type = field(effect, 'type', effectName);
		if (typeof type !== 'string' || !type.length) throw new TypeError(`${effectName}.type must be a non-empty string.`);
		const parameterIds = Object.keys(videoEffectDefinition(type).params);
		const params = readClosedDomainRecord(field(effect, 'params', effectName), `${effectName}.params`, parameterIds, []);
		return { id: field(effect, 'id', effectName), type, enabled: field(effect, 'enabled', effectName),
			params: Object.fromEntries(Object.keys(params).map(key => [key, field(params, key, `${effectName}.params`)])) };
	});
	return Object.freeze(normalizeVideoEffects(snapshots, name).map((effect, index): NormalizedContextVideoEffect => {
		// Point values have already passed their closed owning registry admission.
		const params = effect.type === 'point-curves-v1' ? effect.params : Object.fromEntries(Object.entries(effect.params).map(([key, value]) => {
			if (typeof value !== 'number') throw new TypeError(`${name}[${String(index)}].params.${key} must be numeric.`);
			return [key, value] as const;
		}));
		return Object.freeze({ id: effect.id, type: effect.type, enabled: effect.enabled, params: Object.freeze(params) });
	}));
}
