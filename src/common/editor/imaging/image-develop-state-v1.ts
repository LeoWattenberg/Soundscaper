/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateV1 } from './image-develop-contract-v1.ts';
import { normalizeImageDevelopEffectsV1 } from './image-develop-effects-v1.ts';
import { normalizeImageDevelopEnvelopeV1 } from './image-develop-envelope-v1.ts';
import { field, record } from './image-develop-value.ts';

/** One product-neutral owner for Photo state and shared preset recipes. */
export function normalizeImageDevelopStateV1(value: unknown): ImageDevelopStateV1 {
	const input = record(value, 'photo develop', ['processVersion', 'effects', 'geometry', 'masks', 'maskBindings']);
	if (field(input, 'processVersion') !== 1) throw new RangeError('Unsupported photo develop process version.');
	const effects = normalizeImageDevelopEffectsV1(field(input, 'effects'));
	return Object.freeze({ processVersion: 1, effects, ...normalizeImageDevelopEnvelopeV1(input, effects) });
}

export function cloneImageDevelopStateV1(value: unknown): ImageDevelopStateV1 { return normalizeImageDevelopStateV1(value); }
export function defaultImageDevelopStateV1(): ImageDevelopStateV1 {
	return normalizeImageDevelopStateV1({ processVersion: 1, effects: [], masks: [], maskBindings: [],
		geometry: { crop: null, rotationDegrees: 0, flipHorizontal: false, flipVertical: false } });
}
