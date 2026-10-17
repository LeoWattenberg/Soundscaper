/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionComposition, MotionLayer } from '../common/editor/motion-composition.ts';
import { addRationals, type Rational } from '../common/editor/timeline-time.ts';
import { motionLayerDependencyIds, remapMotionLayerLinks } from '../common/editor/motion-layer-links.ts';
import { normalizeMotionLayer } from '../common/editor/motion-layer-validation.ts';
import { freezeMotionValue, motionId, motionRational } from '../common/editor/motion-values.ts';
import { normalizeMotionscaperProject } from './editor-project-validation.ts';
import { createMotionLayer } from './editor-project.ts';
import { applyMotionscaperCommands, type MotionscaperProjectCommand } from './editor-project-commands.ts';
import { motionLayerLifecycleCommands, type MotionscaperLayerLifecycleEdit } from './editor-layer-lifecycle.ts';

export type MotionscaperLayerEdit = MotionscaperLayerLifecycleEdit
	| { readonly type: 'reorder'; readonly layerIds: readonly string[] }
	| { readonly type: 'duplicate'; readonly copies: readonly { readonly layerId: string; readonly newLayerId: string; readonly name?: string }[]; readonly deltaFrames?: Rational }
	| { readonly type: 'move'; readonly layerIds: readonly string[]; readonly deltaFrames: Rational }
	| { readonly type: 'trim'; readonly layerId: string; readonly inFrame: Rational; readonly outFrame: Rational }
	| { readonly type: 'split'; readonly layerId: string; readonly atFrame: Rational; readonly newLayerId: string }
	| { readonly type: 'parent'; readonly layerIds: readonly string[]; readonly parentId: string | null }
	| { readonly type: 'add-null'; readonly newLayerId: string; readonly name: string; readonly layerIds?: readonly string[] }
	| { readonly type: 'precompose'; readonly layerIds: readonly string[]; readonly newCompositionId: string; readonly newLayerId: string; readonly name: string; readonly allowBackdropIsolation?: boolean };

/** Plans one atomic history transaction. Caller supplies fresh identities; no project is published here. */
export function createMotionscaperLayerCommands(options: Readonly<{ project: unknown; compositionId: string; edit: MotionscaperLayerEdit }>): readonly MotionscaperProjectCommand[] {
	const project = normalizeMotionscaperProject(options.project); const compositionId = motionId(options.compositionId);
	const composition = project.compositions.find(({ id }) => id === compositionId); if (!composition) throw new ReferenceError(`Motion composition ${compositionId} is missing.`);
	const edit = options.edit; let commands: readonly MotionscaperProjectCommand[];
	switch (edit.type) {
		case 'rename': case 'remove': case 'set-enabled': case 'set-footage-audio': commands = motionLayerLifecycleCommands(project, composition, select(composition, edit.type === 'rename' ? [edit.layerId] : edit.layerIds), edit); break;
		case 'reorder': commands = [{ type: 'layer/reorder', compositionId, layerIds: edit.layerIds }]; break;
		case 'trim': commands = [{ type: 'layer/trim', compositionId, layerId: edit.layerId, inFrame: edit.inFrame, outFrame: edit.outFrame }]; break;
		case 'split': commands = [{ type: 'layer/split', compositionId, layerId: edit.layerId, atFrame: edit.atFrame, newLayerId: edit.newLayerId }]; break;
		case 'move': commands = select(composition, edit.layerIds).map((layer) => ({ type: 'layer/replace', compositionId, layer: shift(layer, edit.deltaFrames) })); break;
		case 'parent': commands = select(composition, edit.layerIds).map((layer) => ({ type: 'layer/replace', compositionId, layer: { ...layer, parentId: edit.parentId } })); break;
		case 'duplicate': commands = duplicate(composition, edit); break;
		case 'add-null': commands = addNull(composition, edit); break;
		case 'precompose': commands = precompose(composition, edit); break;
		default: throw new TypeError('Unsupported motion layer edit.');
	}
	applyMotionscaperCommands(project, commands); // Validate the complete final relationship graph before returning reviewable intent.
	return freezeMotionValue(commands);
}

function select(composition: MotionComposition, ids: readonly string[], allowEmpty = false): readonly MotionLayer[] {
	if (!Array.isArray(ids) || (!allowEmpty && ids.length === 0) || ids.length > 4096) throw new RangeError('Select between one and 4096 motion layers.');
	const selected = new Set(ids.map((id) => motionId(id))); if (selected.size !== ids.length) throw new RangeError('Motion layer selection contains duplicate identities.');
	const layers = composition.layers.filter(({ id }) => selected.has(id)); if (layers.length !== selected.size) throw new ReferenceError('A selected motion layer is missing.'); return layers;
}
function shift(layer: MotionLayer, delta: Rational): MotionLayer {
	const amount = motionRational(delta, 'layer movement');
	return normalizeMotionLayer({ ...layer, startFrame: addRationals(layer.startFrame, amount), inFrame: addRationals(layer.inFrame, amount), outFrame: addRationals(layer.outFrame, amount) });
}
function duplicate(composition: MotionComposition, edit: Extract<MotionscaperLayerEdit, { type: 'duplicate' }>): readonly MotionscaperProjectCommand[] {
	const selected = select(composition, edit.copies.map(({ layerId }) => layerId));
	const identities = new Map(edit.copies.map(({ layerId, newLayerId }) => [layerId, motionId(newLayerId)]));
	const names = new Map(edit.copies.map(({ layerId, name }) => [layerId, name]));
	const index = composition.layers.indexOf(selected[0]!);
	return selected.map((layer, offset) => ({ type: 'layer/add', compositionId: composition.id, index: index + offset,
		layer: normalizeMotionLayer({ ...remapMotionLayerLinks(shift(layer, edit.deltaFrames ?? { num: 0, den: 1 }), identities), id: identities.get(layer.id)!, name: names.get(layer.id) ?? `${layer.name} copy` }) }));
}
function addNull(composition: MotionComposition, edit: Extract<MotionscaperLayerEdit, { type: 'add-null' }>): readonly MotionscaperProjectCommand[] {
	const selected = select(composition, edit.layerIds ?? [], true); const parents = new Set(selected.map(({ parentId }) => parentId));
	if (parents.size > 1) throw new RangeError('Group layers with a shared parent so the identity null preserves every animated transform.');
	const id = motionId(edit.newLayerId); const parentId = selected[0]?.parentId ?? null;
	const layer = { ...createMotionLayer({ id, name: edit.name, durationFrames: composition.durationFrames, content: { kind: 'null' } }), parentId };
	return [{ type: 'layer/add', compositionId: composition.id, layer, index: selected.length ? composition.layers.indexOf(selected[0]!) : 0 },
		...selected.map((item): MotionscaperProjectCommand => ({ type: 'layer/replace', compositionId: composition.id, layer: { ...item, parentId: id } }))];
}
function precompose(composition: MotionComposition, edit: Extract<MotionscaperLayerEdit, { type: 'precompose' }>): readonly MotionscaperProjectCommand[] {
	const selected = select(composition, edit.layerIds); const ids = new Set(selected.map(({ id }) => id)); const index = composition.layers.indexOf(selected[0]!);
	if (composition.layers.slice(index, index + selected.length).some(({ id }) => !ids.has(id))) throw new RangeError('Select contiguous layers before precomposing to preserve layer order.');
	for (const layer of composition.layers) for (const dependency of motionLayerDependencyIds(layer)) if (ids.has(layer.id) !== ids.has(dependency)) {
		throw new RangeError(`Include the dependent layers ${layer.name} and ${dependency} in the same precomposition selection.`);
	}
	if (!edit.allowBackdropIsolation && selected.some(({ blendMode, kind }) => blendMode !== 'normal' || kind === 'adjustment')) throw new RangeError('Confirm backdrop isolation before precomposing blend or adjustment layers; their appearance can change against layers outside the selection.');
	const child: MotionComposition = { ...composition, id: motionId(edit.newCompositionId), name: edit.name, background: [0, 0, 0, 0], layers: selected, audio: [] };
	const layer = createMotionLayer({ id: edit.newLayerId, name: edit.name, durationFrames: composition.durationFrames, content: { kind: 'precomp', compositionId: child.id } });
	const layers = [...composition.layers.slice(0, index), layer, ...composition.layers.slice(index + selected.length)];
	return [{ type: 'composition/add', composition: child }, { type: 'composition/replace', composition: { ...composition, layers } }];
}
