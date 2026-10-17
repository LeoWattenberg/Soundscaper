/* SPDX-License-Identifier: AGPL-3.0-only */

import { CUBE_LUT_PROFILE_EFFECT_TYPE_V1, normalizeCubeLutProfileEffectV1 } from '../video-cube-lut-profile-v1.ts';
import type { VideoEffectLeafV2 } from '../video-effect-leaf-v2.ts';
import type { ImageDevelopGeometryV1, ImageDevelopMaskBindingV1, ImageDevelopStateV1 } from './image-develop-contract-v1.ts';
import type { VideoMaskMatteGraphV1OrV2 } from '../video-mask-matte-name-v2.ts';
import { captureImageDevelopEffectsV1, normalizeImageDevelopEffectsV1, type ImageDevelopCapturedEffectV1 } from './image-develop-effects-v1.ts';
import { normalizeImageDevelopEnvelopeV2 } from './image-develop-envelope-v2.ts';
import { defaultImageDevelopStateV1, normalizeImageDevelopStateV1 } from './image-develop-state-v1.ts';
import { field, record, unique } from './image-develop-value.ts';

/** Explicit process2 successor for resource-bearing effects and named masks.
 * Recipe bytes carry closed metadata; repository and render owners must independently prove resource bodies. */
export interface ImageDevelopStateV2 {
	readonly processVersion: 2;
	readonly effects: readonly VideoEffectLeafV2[];
	readonly geometry: ImageDevelopGeometryV1;
	readonly masks: readonly VideoMaskMatteGraphV1OrV2[];
	readonly maskBindings: readonly ImageDevelopMaskBindingV1[];
}

export function normalizeImageDevelopStateV2(value: unknown): ImageDevelopStateV2 {
	const input = record(value, 'photo develop', ['processVersion', 'effects', 'geometry', 'masks', 'maskBindings']);
	if (field(input, 'processVersion') !== 2) throw new RangeError('Unsupported photo develop process version.');
	const effects = Object.freeze(captureImageDevelopEffectsV1(field(input, 'effects')).map(normalizeEffect));
	unique(effects.map(effect => effect.id), 'photo effects');
	return Object.freeze({ processVersion: 2, effects, ...normalizeImageDevelopEnvelopeV2(input, effects) });
}

/** Consumers explicitly opt into both owners; V1 itself never upgrades. */
export function normalizeImageDevelopStateV1OrV2(value: unknown): ImageDevelopStateV1 | ImageDevelopStateV2 {
	const input = record(value, 'photo develop', ['processVersion', 'effects', 'geometry', 'masks', 'maskBindings']);
	const processVersion = field(input, 'processVersion');
	if (processVersion === 1) return normalizeImageDevelopStateV1(input);
	if (processVersion === 2) return normalizeImageDevelopStateV2(input);
	throw new RangeError('Unsupported photo develop process version.');
}

export function defaultImageDevelopStateV2(): ImageDevelopStateV2 {
	return normalizeImageDevelopStateV2({ ...defaultImageDevelopStateV1(), processVersion: 2 });
}

function normalizeEffect(candidate: ImageDevelopCapturedEffectV1): VideoEffectLeafV2 {
	if (candidate.type === CUBE_LUT_PROFILE_EFFECT_TYPE_V1) {
		const effect = normalizeCubeLutProfileEffectV1(candidate);
		return Object.freeze({ id: effect.id, type: effect.type, enabled: effect.enabled, params: Object.freeze({ lut: effect.params.lut }) });
	}
	const effect = normalizeImageDevelopEffectsV1([candidate])[0];
	if (!effect) throw new TypeError('Photo develop requires an owning effect.');
	return effect;
}
