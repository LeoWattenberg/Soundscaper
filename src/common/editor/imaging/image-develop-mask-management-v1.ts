/* SPDX-License-Identifier: AGPL-3.0-only */

import { IMAGE_DEVELOP_LIMITS_V1 } from './image-develop-contract-v1.ts';
import { normalizeImageDevelopStateV1OrV2 } from './image-develop-state-v2.ts';
import { array, field, id, record, unique } from './image-develop-value.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1 } from '../video-image-geometry-v1.ts';

export type ImageDevelopMaskManagementCommandV1 =
	| Readonly<{ type: 'duplicate'; maskId: string; duplicateId: string }>
	| Readonly<{ type: 'remove'; maskId: string }>
	| Readonly<{ type: 'bindings'; maskId: string; effectIds: readonly string[] }>;

/** Manage retained graph identity and use without acquiring any body authority.
 * Graph duplication preserves every declared input/node, including unused
 * resources. A binding claims its effect from any previously bound graph. */
export function manageImageDevelopMasksV1(developValue: unknown, commandValue: unknown): ReturnType<typeof normalizeImageDevelopStateV1OrV2> {
	const develop = normalizeImageDevelopStateV1OrV2(developValue), command = admitCommand(commandValue);
	const selected = develop.masks.find(mask => mask.id === command.maskId);
	if (!selected) throw new ReferenceError('Mask management references a missing graph.');
	if (command.type === 'duplicate') {
		if (develop.masks.some(mask => mask.id === command.duplicateId)) throw new RangeError('The duplicate mask ID already exists.');
		if (develop.masks.length >= IMAGE_DEVELOP_LIMITS_V1.maximumMasks) throw new RangeError('Mask duplication exceeds the recipe graph limit.');
		return normalizeImageDevelopStateV1OrV2({ ...develop, masks: [...develop.masks, { ...selected, id: command.duplicateId }] });
	}
	if (command.type === 'remove') return normalizeImageDevelopStateV1OrV2({ ...develop,
		masks: develop.masks.filter(mask => mask.id !== command.maskId),
		maskBindings: develop.maskBindings.filter(binding => binding.maskId !== command.maskId) });
	const effects = new Map(develop.effects.map(effect => [effect.id, effect]));
	for (const effectId of command.effectIds) {
		const effect = effects.get(effectId);
		if (!effect) throw new ReferenceError('Mask management references a missing effect.');
		if (effect.type === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1) throw new RangeError('Image geometry cannot receive a mask binding.');
	}
	const claimed = new Set(command.effectIds);
	return normalizeImageDevelopStateV1OrV2({ ...develop, maskBindings: [
		...develop.maskBindings.filter(binding => binding.maskId !== command.maskId && !claimed.has(binding.effectId)),
		...command.effectIds.map(effectId => ({ effectId, maskId: command.maskId })),
	] });
}

function admitCommand(value: unknown): ImageDevelopMaskManagementCommandV1 {
	const name = 'image mask management command';
	const input = record(value, name, ['type', 'maskId', 'duplicateId', 'effectIds'], ['type', 'maskId']);
	const type = field(input, 'type'), maskId = id(field(input, 'maskId'), 'mask management graph ID');
	if (type === 'duplicate') {
		const command = record(input, name, ['type', 'maskId', 'duplicateId']);
		return Object.freeze({ type, maskId, duplicateId: id(field(command, 'duplicateId'), 'duplicate mask ID') });
	}
	if (type === 'remove') { record(input, name, ['type', 'maskId']); return Object.freeze({ type, maskId }); }
	if (type === 'bindings') {
		const command = record(input, name, ['type', 'maskId', 'effectIds']);
		const effectIds = array(field(command, 'effectIds'), 'mask management effect IDs', 0, IMAGE_DEVELOP_LIMITS_V1.maximumEffects)
			.map(value => id(value, 'mask management effect ID'));
		unique(effectIds, 'mask management effect IDs');
		return Object.freeze({ type, maskId, effectIds: Object.freeze(effectIds) });
	}
	throw new RangeError('Unsupported mask management command.');
}
