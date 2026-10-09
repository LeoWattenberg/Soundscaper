/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeVideoEffects } from '../video-effects.js';
import type { VideoEffectLeaf } from '../project-media-types.ts';
import { IMAGE_DEVELOP_LIMITS_V1 } from './image-develop-contract-v1.ts';
import { array, boolean, field, id, record } from './image-develop-value.ts';

export interface ImageDevelopCapturedEffectV1 {
	readonly id: string;
	readonly type: unknown;
	readonly enabled: boolean;
	readonly params: Readonly<Record<string, unknown>>;
}

/** Capture only inert effect envelopes; family owners admit nested parameters. */
export function captureImageDevelopEffectsV1(value: unknown): readonly ImageDevelopCapturedEffectV1[] {
	return array(value, 'photo effects', 0, IMAGE_DEVELOP_LIMITS_V1.maximumEffects).map(candidate => {
		const effect = record(candidate, 'photo effect', ['id', 'type', 'enabled', 'params']);
		const paramsValue = field(effect, 'params');
		if (!paramsValue || typeof paramsValue !== 'object') throw new TypeError('Photo effect params require a plain object.');
		const params = record(paramsValue, 'photo effect params', Object.keys(paramsValue));
		const detachedParams = Object.create(null) as Record<string, unknown>;
		for (const key of Object.keys(params)) detachedParams[key] = field(params, key);
		return { id: id(field(effect, 'id'), 'photo effect ID'), type: field(effect, 'type'),
			enabled: boolean(field(effect, 'enabled'), 'photo effect enabled'), params: detachedParams };
	});
}

/** Process1 remains numeric/curve-only even if the shared registry gains a
 * resource-bearing family. Owning normalizers retain all default semantics. */
export function normalizeImageDevelopEffectsV1(value: unknown): readonly VideoEffectLeaf[] {
	const normalized = normalizeVideoEffects(captureImageDevelopEffectsV1(value), 'photo effects') as VideoEffectLeaf[];
	return Object.freeze(normalized.map(effect => {
		if (Object.values(effect.params).some(parameter => typeof parameter !== 'number' && !Array.isArray(parameter))) {
			throw new RangeError('Resource effect parameters require photo develop process version 2.');
		}
		return Object.freeze({ id: effect.id, type: effect.type, enabled: effect.enabled, params: Object.freeze({ ...effect.params }) });
	}));
}
