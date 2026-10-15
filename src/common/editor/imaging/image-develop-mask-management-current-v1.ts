/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeImageDevelopStateCurrentV1, type ImageDevelopStateCurrentV1 } from './image-develop-state-current-v1.ts';
import { manageImageDevelopMasksV3 } from './image-develop-mask-management-v3.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { LENS_DISTORTION_EFFECT_TYPE_V1 } from '../video-lens-distortion-v1.ts';

export interface ImageDevelopLocalMasksReplacementCurrentV1 {
	readonly effects: ImageDevelopStateCurrentV1['effects'];
	readonly masks: ImageDevelopStateCurrentV1['masks'];
	readonly maskBindings: ImageDevelopStateCurrentV1['maskBindings'];
}
/** A computational view stays private; the owning Current command reattaches
 * the complete admitted repair metadata before returning any authored state. */
export function manageImageDevelopMasksCurrentV1(develop: unknown, command: unknown): Readonly<ImageDevelopStateCurrentV1> {
	const source = normalizeImageDevelopStateCurrentV1(develop);
	if (source.processVersion !== 3) return admitBindings(manageImageDevelopMasksV3(source, command));
	const { repairs, ...recipe } = source;
	const result = manageImageDevelopMasksV3({ ...recipe, processVersion: 2 }, command);
	return admitBindings(normalizeImageDevelopStateCurrentV1({ ...result, processVersion: 3, repairs }));
}
export function replaceImageDevelopLocalMasksCurrentV1(develop: unknown, replacement: unknown): Readonly<ImageDevelopStateCurrentV1> {
	const source = normalizeImageDevelopStateCurrentV1(develop), label = 'Current local masks';
	const input = record(replacement, label, ['effects', 'masks', 'maskBindings']);
	return admitBindings(normalizeImageDevelopStateCurrentV1({ ...source, effects: field(input, 'effects', label),
		masks: field(input, 'masks', label), maskBindings: field(input, 'maskBindings', label) }));
}

function admitBindings(value: Readonly<ImageDevelopStateCurrentV1>): Readonly<ImageDevelopStateCurrentV1> {
	const bound = new Set(value.maskBindings.map(binding => binding.effectId));
	if (value.effects.some(effect => effect.type === LENS_DISTORTION_EFFECT_TYPE_V1 && bound.has(effect.id))) {
		throw new RangeError('Lens distortion cannot receive a mask binding.');
	}
	return value;
}
