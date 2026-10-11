/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionEffect, MotionLayer, MotionMask } from '../common/editor/motion-composition.ts';
import { motionScalar, motionVector, type MotionPathProperty } from '../common/editor/motion-property.ts';
import { freezeMotionValue, motionArray, motionId, motionInteger } from '../common/editor/motion-values.ts';
import { videoEffectDefaults, validateVideoEffectParams } from '../common/editor/video-effects.js';
import { createMotionLayer } from './editor-project.ts';
import { normalizeMotionscaperProject } from './editor-project-validation.ts';
import { applyMotionscaperCommands, type MotionscaperProjectCommand } from './editor-project-commands.ts';

type CollectionEdit<Value> = { readonly type: 'add'; readonly value: Value; readonly index: number } | { readonly type: 'replace'; readonly value: Value }
	| { readonly type: 'remove'; readonly id: string } | { readonly type: 'reorder'; readonly ids: readonly string[] };
export type MotionscaperCompositingEdit =
	| { readonly type: 'mask'; readonly change: CollectionEdit<MotionMask> }
	| { readonly type: 'effect'; readonly change: CollectionEdit<MotionEffect> }
	| { readonly type: 'composite'; readonly blendMode: MotionLayer['blendMode']; readonly matte: MotionLayer['matte'] }
	| { readonly type: 'add-adjustment'; readonly id: string; readonly name: string }
	| { readonly type: 'adjustment-targets' };

export function createMotionAuthoredMask(id: string, path: MotionPathProperty): MotionMask {
	return freezeMotionValue({ id: motionId(id), path, opacity: motionScalar(1), feather: motionVector([0, 0]), expansion: motionScalar(0), inverted: false, operation: 'add' });
}
export function createMotionAuthoredEffect(options: Readonly<{ id: string; type: string; width: number; height: number }>): MotionEffect {
	const parameters = options.type === 'corner-pin'
		? ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((id, index) => ({ id, value: motionVector([index === 1 || index === 2 ? options.width : 0, index >= 2 ? options.height : 0]) }))
		: Object.entries(videoEffectDefaults(options.type)).map(([id, value]) => ({ id, value: motionScalar(value) }));
	return freezeMotionValue({ id: motionId(options.id), type: options.type, enabled: true, parameters });
}
/** Ordered local masks/effects and relationship edits publish as one validated history step. */
export function createMotionscaperCompositingCommands(options: Readonly<{ project: unknown; compositionId: string; layerId?: string; edit: MotionscaperCompositingEdit }>): readonly MotionscaperProjectCommand[] {
	const project = normalizeMotionscaperProject(options.project); const compositionId = motionId(options.compositionId);
	const composition = project.compositions.find(({ id }) => id === compositionId); if (!composition) throw new ReferenceError(`Motion composition ${compositionId} is missing.`);
	const edit = options.edit; let commands: readonly MotionscaperProjectCommand[];
	if (edit.type === 'add-adjustment') {
		const layer = createMotionLayer({ id: edit.id, name: edit.name, durationFrames: composition.durationFrames, content: { kind: 'adjustment', targetLayerIds: targets(composition.layers) } });
		commands = [{ type: 'layer/add', compositionId, layer, index: 0 }];
	} else {
		const layerId = motionId(options.layerId); const index = composition.layers.findIndex(({ id }) => id === layerId); const layer = composition.layers[index];
		if (!layer) throw new ReferenceError(`Motion layer ${layerId} is missing.`);
		let next: MotionLayer;
		if (edit.type === 'composite') next = { ...layer, blendMode: edit.blendMode, matte: edit.matte };
		else if (edit.type === 'mask') {
			const masks = collection(layer.masks, edit.change); for (const mask of masks) {
				if (mask.opacity.value < 0 || mask.opacity.value > 1 || mask.feather.value.some((value) => value < 0 || value > 128)) throw new RangeError('Mask opacity must be 0…1 and feather sigma 0…128 local pixels.');
			}
			next = { ...layer, masks };
		} else if (edit.type === 'effect') {
			const effects = collection(layer.effects, edit.change); for (const effect of effects) validateEffect(effect);
			next = { ...layer, effects };
		} else {
			if (layer.kind !== 'adjustment') throw new TypeError('Adjustment targets require an adjustment layer.');
			next = { ...layer, targetLayerIds: targets(composition.layers, index + 1) };
		}
		commands = [{ type: 'layer/replace', compositionId, layer: next }];
	}
	applyMotionscaperCommands(project, commands); return freezeMotionValue(commands);
}
function targets(layers: readonly MotionLayer[], start = 0): readonly string[] {
	const matteSources = new Set(layers.flatMap((layer) => layer.matte ? [layer.matte.layerId] : []));
	return layers.slice(start).filter((layer) => !['null', 'camera', 'light', 'adjustment'].includes(layer.kind) && !matteSources.has(layer.id)).map(({ id }) => id);
}
function validateEffect(effect: MotionEffect): void {
	if (effect.type === 'corner-pin') {
		const names = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
		if (effect.parameters.length !== 4 || effect.parameters.some((parameter) => !names.includes(parameter.id) || parameter.value.kind !== 'vector2')) throw new TypeError('Corner pin requires four vector2 corner parameters.');
	} else {
		if (effect.parameters.some((parameter) => parameter.value.kind !== 'scalar')) throw new TypeError('Registered effect parameters must be scalar properties.');
		validateVideoEffectParams(effect.type, Object.fromEntries(effect.parameters.map((parameter) => [parameter.id, parameter.value.value])));
	}
}
function collection<Value extends { readonly id: string }>(values: readonly Value[], edit: CollectionEdit<Value>): readonly Value[] {
	if (edit.type === 'add') { const index = motionInteger(edit.index, 'compositing insertion index', 0, values.length); return [...values.slice(0, index), edit.value, ...values.slice(index)]; }
	const byId = new Map(values.map((value) => [value.id, value]));
	if (edit.type === 'reorder') {
		const ids = motionArray(edit.ids, 256, 'compositing order').map((id) => motionId(id));
		if (ids.length !== values.length || new Set(ids).size !== values.length || ids.some((id) => !byId.has(id))) throw new RangeError('Compositing order must contain every identity exactly once.');
		return ids.map((id) => byId.get(id)!);
	}
	const id = motionId(edit.type === 'replace' ? edit.value.id : edit.id); if (!byId.has(id)) throw new ReferenceError(`Compositing identity ${id} is missing.`);
	return edit.type === 'remove' ? values.filter((value) => value.id !== id) : values.map((value) => value.id === id ? edit.value : value);
}
