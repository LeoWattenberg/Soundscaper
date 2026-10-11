/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopGeometryV1, ImageDevelopMaskBindingV1 } from './image-develop-contract-v1.ts';
import { IMAGE_DEVELOP_LIMITS_V1 } from './image-develop-contract-v1.ts';
import type { VideoMaskMatteGraphV1 } from '../video-mask-matte-v24.ts';
import type { VideoMaskMatteGraphV1OrV2 } from '../video-mask-matte-name-v2.ts';
import type { ImageDevelopSelectionV1 } from './image-develop-settings-contract-v1.ts';
import { defaultImageDevelopStateV1 } from './image-develop-state-v1.ts';

export interface ImageDevelopSettingsGroupsV1<Effect extends Readonly<{ id: string; type: string }>, Mask extends VideoMaskMatteGraphV1OrV2 = VideoMaskMatteGraphV1> {
	readonly effects: readonly Effect[];
	readonly geometry: ImageDevelopGeometryV1;
	readonly masks: readonly Mask[];
	readonly maskBindings: readonly ImageDevelopMaskBindingV1[];
}

/** Pure group algorithms receive already owning-normalized states/selection.
 * They admit no process or nested parameter and confer no resource authority. */
export function copyImageDevelopGroupsV1<Effect extends Readonly<{ id: string; type: string }>, Mask extends VideoMaskMatteGraphV1OrV2 = VideoMaskMatteGraphV1>(
	develop: ImageDevelopSettingsGroupsV1<Effect, Mask>, selection: ImageDevelopSelectionV1,
): ImageDevelopSettingsGroupsV1<Effect, Mask> {
	const bound = new Set(develop.maskBindings.map(binding => binding.effectId));
	const effects = develop.effects.filter(effect => selected(effect, selection, bound));
	const ids = new Set(effects.map(effect => effect.id));
	const maskBindings = develop.maskBindings.filter(binding => ids.has(binding.effectId));
	const maskIds = new Set(maskBindings.map(binding => binding.maskId));
	const masks = selection.localAdjustments && selection.effectTypes === 'all' ? develop.masks : develop.masks.filter(mask => maskIds.has(mask.id));
	if (masks.some(mask => mask.inputs.length > 0)) throw new RangeError('External mask media requires an authenticated settings adapter.');
	return { effects, masks, maskBindings, geometry: selection.geometry ? develop.geometry : defaultImageDevelopStateV1().geometry };
}

/** Insert the donated group at its first replaced target position; keep all
 * unselected IDs/order and remap only real colliding effect/mask identities. */
export function mergeImageDevelopGroupsV1<Effect extends Readonly<{ id: string; type: string }>, Mask extends VideoMaskMatteGraphV1OrV2 = VideoMaskMatteGraphV1>(
	target: ImageDevelopSettingsGroupsV1<Effect, Mask>, source: ImageDevelopSettingsGroupsV1<Effect, Mask>, selection: ImageDevelopSelectionV1,
): ImageDevelopSettingsGroupsV1<Effect, Mask> {
	if (selection.effectTypes === 'all' && selection.localAdjustments) {
		return { effects: source.effects, masks: source.masks, maskBindings: source.maskBindings,
			geometry: selection.geometry ? source.geometry : target.geometry };
	}
	const bound = new Set(target.maskBindings.map(binding => binding.effectId));
	const retained = target.effects.filter(effect => !selected(effect, selection, bound));
	const retainedIds = new Set(retained.map(effect => effect.id));
	const effectIds = new Map<string, string>(), reserved = new Set([...retainedIds, ...source.effects.map(effect => effect.id)]);
	const effects = source.effects.map(effect => {
		const id = retainedIds.has(effect.id) ? allocateImageDevelopSettingsIdV1(reserved, 'copied-effect') : effect.id;
		effectIds.set(effect.id, id); return { ...effect, id };
	});
	const retainedMaskIds = new Set(target.maskBindings.filter(binding => retainedIds.has(binding.effectId)).map(binding => binding.maskId));
	const formerlyBoundMasks = new Set(target.maskBindings.map(binding => binding.maskId));
	const masks = target.masks.filter(mask => retainedMaskIds.has(mask.id) || !formerlyBoundMasks.has(mask.id));
	const maskIds = new Map<string, string>();
	const reservedMasks = new Set([...masks.map(mask => mask.id), ...source.masks.map(mask => mask.id)]);
	for (const mask of source.masks) {
		const existing = masks.find(candidate => candidate.id === mask.id);
		if (existing && JSON.stringify(existing) === JSON.stringify(mask)) { maskIds.set(mask.id, mask.id); continue; }
		const id = existing ? allocateImageDevelopSettingsIdV1(reservedMasks, 'copied-mask') : mask.id;
		maskIds.set(mask.id, id); masks.push({ ...mask, id });
	}
	const insertion = target.effects.findIndex(effect => selected(effect, selection, bound));
	const position = insertion < 0 ? retained.length : insertion;
	const maskBindings = [...target.maskBindings.filter(binding => retainedIds.has(binding.effectId)),
		...source.maskBindings.map(binding => ({ effectId: effectIds.get(binding.effectId)!, maskId: maskIds.get(binding.maskId)! }))];
	return { effects: [...retained.slice(0, position), ...effects, ...retained.slice(position)],
		geometry: selection.geometry ? source.geometry : target.geometry, masks, maskBindings };
}

function selected(effect: Readonly<{ type: string; id: string }>, selection: ImageDevelopSelectionV1, bound: ReadonlySet<string>): boolean {
	return (selection.effectTypes === 'all' || selection.effectTypes.includes(effect.type)) && (selection.localAdjustments || !bound.has(effect.id));
}

export function allocateImageDevelopSettingsIdV1(reserved: Set<string>, prefix: string): string {
	for (let index = 1; index <= IMAGE_DEVELOP_LIMITS_V1.maximumEffects + IMAGE_DEVELOP_LIMITS_V1.maximumMasks + 1; index++) {
		const id = `${prefix}-${String(index)}`;
		if (!reserved.has(id)) { reserved.add(id); return id; }
	}
	throw new RangeError('Develop settings ID allocation exceeded its bound.');
}
