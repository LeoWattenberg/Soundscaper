/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionShape } from '../common/editor/motion-composition.ts';
import { freezeMotionValue, motionArray, motionId, motionInteger } from '../common/editor/motion-values.ts';
import { normalizeMotionscaperProject } from './editor-project-validation.ts';
import { applyMotionscaperCommands, type MotionscaperProjectCommand } from './editor-project-commands.ts';

export type MotionscaperShapeEdit =
	| { readonly type: 'add'; readonly value: MotionShape; readonly index: number }
	| { readonly type: 'replace'; readonly value: MotionShape }
	| { readonly type: 'duplicate'; readonly id: string; readonly newId: string }
	| { readonly type: 'remove'; readonly id: string }
	| { readonly type: 'reorder'; readonly ids: readonly string[] };

/** Shape identity, animated topology, appearance and property links publish together. */
export function createMotionscaperShapeCommands(options: Readonly<{ project: unknown; compositionId: string; layerId: string; edit: MotionscaperShapeEdit }>): readonly MotionscaperProjectCommand[] {
	const project = normalizeMotionscaperProject(options.project); const compositionId = motionId(options.compositionId); const layerId = motionId(options.layerId);
	const composition = project.compositions.find(({ id }) => id === compositionId); if (!composition) throw new ReferenceError(`Motion composition ${compositionId} is missing.`);
	const layer = composition.layers.find(({ id }) => id === layerId); if (!layer || layer.kind !== 'shapes') throw new TypeError('Shape collection edits require a shapes layer.');
	const values = layer.shapes; const edit = options.edit; let shapes: readonly MotionShape[];
	if (edit.type === 'add') { const index = motionInteger(edit.index, 'shape insertion index', 0, values.length); shapes = [...values.slice(0, index), edit.value, ...values.slice(index)]; }
	else if (edit.type === 'reorder') {
		const ids = motionArray(edit.ids, 1024, 'shape order').map((id) => motionId(id)); const byId = new Map(values.map((value) => [value.id, value]));
		if (ids.length !== values.length || new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id))) throw new RangeError('Shape order must contain every identity exactly once.');
		shapes = ids.map((id) => byId.get(id)!);
	} else {
		const id = motionId(edit.type === 'replace' ? edit.value.id : edit.id); const index = values.findIndex((value) => value.id === id);
		if (index < 0) throw new ReferenceError(`Motion shape ${id} is missing.`);
		shapes = edit.type === 'remove' ? values.filter((value) => value.id !== id) : edit.type === 'duplicate'
			? [...values.slice(0, index + 1), { ...values[index]!, id: motionId(edit.newId) }, ...values.slice(index + 1)]
			: values.map((value) => value.id === id ? edit.value : value);
	}
	const commands: readonly MotionscaperProjectCommand[] = [{ type: 'layer/replace', compositionId, layer: { ...layer, shapes } }];
	applyMotionscaperCommands(project, commands); return freezeMotionValue(commands);
}
