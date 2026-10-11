/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionShapeOperator, MotionTextAnimator } from '../common/editor/motion-authoring-operators.ts';
import { freezeMotionValue, motionArray, motionId, motionInteger } from '../common/editor/motion-values.ts';
import { normalizeMotionscaperProject } from './editor-project-validation.ts';
import { applyMotionscaperCommands, type MotionscaperProjectCommand } from './editor-project-commands.ts';

type OperatorEdit<Value> =
	| { readonly type: 'add'; readonly value: Value; readonly index: number }
	| { readonly type: 'replace'; readonly value: Value }
	| { readonly type: 'remove'; readonly id: string }
	| { readonly type: 'reorder'; readonly ids: readonly string[] };
type OperatorTarget = { readonly target: 'shape'; readonly edit: OperatorEdit<MotionShapeOperator> } | { readonly target: 'text'; readonly edit: OperatorEdit<MotionTextAnimator> };

/** Property/keyframe edits can subsequently address operators.N.* or document.animators.N.*. */
export function createMotionscaperOperatorCommands(options: Readonly<{ project: unknown; compositionId: string; layerId: string }> & OperatorTarget): readonly MotionscaperProjectCommand[] {
	const project = normalizeMotionscaperProject(options.project); const compositionId = motionId(options.compositionId); const layerId = motionId(options.layerId);
	const composition = project.compositions.find(({ id }) => id === compositionId); if (!composition) throw new ReferenceError(`Motion composition ${compositionId} is missing.`);
	const layer = composition.layers.find(({ id }) => id === layerId); if (!layer) throw new ReferenceError(`Motion layer ${layerId} is missing.`);
	let next: typeof layer;
	if (options.target === 'shape') {
		if (layer.kind !== 'shapes') throw new TypeError('Shape operators require a shapes layer.');
		next = { ...layer, operators: editOperators(layer.operators ?? [], options.edit) };
	} else {
		if (layer.kind !== 'text') throw new TypeError('Text animators require a text layer.');
		next = { ...layer, document: { ...layer.document, animators: editOperators(layer.document.animators ?? [], options.edit) } };
	}
	const commands: readonly MotionscaperProjectCommand[] = [{ type: 'layer/replace', compositionId, layer: next }];
	applyMotionscaperCommands(project, commands); return freezeMotionValue(commands);
}
function editOperators<Value extends { readonly id: string }>(values: readonly Value[], edit: OperatorEdit<Value>): readonly Value[] {
	if (edit.type === 'add') { const index = motionInteger(edit.index, 'operator insertion index', 0, values.length); return [...values.slice(0, index), edit.value, ...values.slice(index)]; }
	const byId = new Map(values.map((value) => [value.id, value]));
	if (edit.type === 'reorder') {
		const ids = motionArray(edit.ids, 256, 'operator order').map((id) => motionId(id));
		if (ids.length !== values.length || new Set(ids).size !== values.length || ids.some((id) => !byId.has(id))) throw new RangeError('Operator order must contain every identity exactly once.');
		return ids.map((id) => byId.get(id)!);
	}
	const id = motionId(edit.type === 'replace' ? edit.value.id : edit.id); if (!byId.has(id)) throw new ReferenceError(`Motion operator ${id} is missing.`);
	return edit.type === 'remove' ? values.filter((value) => value.id !== id) : values.map((value) => value.id === id ? edit.value : value);
}
