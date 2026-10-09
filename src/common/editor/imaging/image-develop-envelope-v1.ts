/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ClosedDomainRecord } from '../closed-domain-value.ts';
import { normalizeVideoMaskMatteGraphV1 } from '../video-mask-matte-v24.ts';
import { IMAGE_DEVELOP_LIMITS_V1, type ImageDevelopGeometryV1, type ImageDevelopStateV1 } from './image-develop-contract-v1.ts';
import { array, boolean, compareText, field, id, number, record, unique } from './image-develop-value.ts';

type ImageDevelopEnvelopeV1 = Pick<ImageDevelopStateV1, 'geometry' | 'masks' | 'maskBindings'>;

/** Shared geometry/mask admission uses the real normalized effect identities.
 * It does not admit a process version, effects, or a complete develop state. */
export function normalizeImageDevelopEnvelopeV1(input: ClosedDomainRecord, effects: readonly Readonly<{ id: string }>[]): ImageDevelopEnvelopeV1 {
	const masks = array(field(input, 'masks'), 'photo masks', 0, IMAGE_DEVELOP_LIMITS_V1.maximumMasks)
		.map(normalizeVideoMaskMatteGraphV1).sort((left, right) => compareText(left.id, right.id));
	unique(masks.map(mask => mask.id), 'photo masks');
	const effectIds = new Set(effects.map(effect => effect.id)), maskIds = new Set(masks.map(mask => mask.id));
	const bindings = array(field(input, 'maskBindings'), 'photo mask bindings', 0, IMAGE_DEVELOP_LIMITS_V1.maximumEffects).map(candidate => {
		const binding = record(candidate, 'photo mask binding', ['effectId', 'maskId']);
		const effectId = id(field(binding, 'effectId'), 'mask binding effect ID'), maskId = id(field(binding, 'maskId'), 'mask binding mask ID');
		if (!effectIds.has(effectId) || !maskIds.has(maskId)) throw new ReferenceError('A photo mask binding references a missing effect or mask.');
		return Object.freeze({ effectId, maskId });
	}).sort((left, right) => compareText(left.effectId, right.effectId));
	unique(bindings.map(binding => binding.effectId), 'photo effect mask bindings');
	return Object.freeze({ geometry: normalizeGeometry(field(input, 'geometry')), masks: Object.freeze(masks), maskBindings: Object.freeze(bindings) });
}

function normalizeGeometry(value: unknown): ImageDevelopGeometryV1 {
	const input = record(value, 'photo geometry', ['crop', 'rotationDegrees', 'flipHorizontal', 'flipVertical']);
	const candidate = field(input, 'crop');
	let crop: ImageDevelopGeometryV1['crop'] = null;
	if (candidate !== null) {
		const inputCrop = record(candidate, 'photo crop', ['x', 'y', 'width', 'height']);
		const x = number(field(inputCrop, 'x'), 0, 1, 'photo crop x'), y = number(field(inputCrop, 'y'), 0, 1, 'photo crop y');
		const width = number(field(inputCrop, 'width'), Number.MIN_VALUE, 1, 'photo crop width');
		const height = number(field(inputCrop, 'height'), Number.MIN_VALUE, 1, 'photo crop height');
		if (x + width > 1 || y + height > 1) throw new RangeError('Photo crop must lie inside the original image.');
		crop = Object.freeze({ x, y, width, height });
	}
	return Object.freeze({ crop, rotationDegrees: number(field(input, 'rotationDegrees'), -180, 180, 'photo rotation'),
		flipHorizontal: boolean(field(input, 'flipHorizontal'), 'photo horizontal flip'), flipVertical: boolean(field(input, 'flipVertical'), 'photo vertical flip') });
}
