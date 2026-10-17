/* SPDX-License-Identifier: AGPL-3.0-only */

import { motionLayerProperties } from '../common/editor/motion-project-graph.ts';
import { replaceMotionLayerProperty } from '../common/editor/motion-layer-links.ts';
import { editMotionKeyframes, pasteMotionKeyframes, type MotionKeyframeClipboard, type MotionKeyframeEdit } from '../common/editor/motion-keyframe-edit.ts';
import type { MotionProperty } from '../common/editor/motion-property.ts';
import type { Rational } from '../common/editor/timeline-time.ts';
import { freezeMotionValue, motionId } from '../common/editor/motion-values.ts';
import { normalizeMotionscaperProject } from './editor-project-validation.ts';
import { applyMotionscaperCommands, type MotionscaperProjectCommand } from './editor-project-commands.ts';

export type MotionscaperPropertyEdit = MotionKeyframeEdit
	| { readonly type: 'paste-keys'; readonly clipboard: MotionKeyframeClipboard; readonly atFrame: Rational; readonly mode: 'merge' | 'replace' }
	| { readonly type: 'replace-property'; readonly property: MotionProperty };

/** Property paths come from motionLayerProperties; key coordinates are layer-local composition frames. */
export function createMotionscaperPropertyCommands(options: Readonly<{ project: unknown; compositionId: string; layerId: string; propertyPath: string; edit: MotionscaperPropertyEdit }>): readonly MotionscaperProjectCommand[] {
	const project = normalizeMotionscaperProject(options.project); const compositionId = motionId(options.compositionId); const layerId = motionId(options.layerId);
	const composition = project.compositions.find(({ id }) => id === compositionId); if (!composition) throw new ReferenceError(`Motion composition ${compositionId} is missing.`);
	const layer = composition.layers.find(({ id }) => id === layerId); if (!layer) throw new ReferenceError(`Motion layer ${layerId} is missing.`);
	const current = motionLayerProperties(layer).find(({ path }) => path === options.propertyPath); if (!current) throw new ReferenceError(`Motion property ${options.propertyPath} is missing.`);
	const edit = options.edit; const property = edit.type === 'replace-property' ? edit.property : edit.type === 'paste-keys'
		? pasteMotionKeyframes(current.property, edit.clipboard, { atFrame: edit.atFrame, frameRate: composition.frameRate, mode: edit.mode }) : editMotionKeyframes(current.property, edit);
	const commands: readonly MotionscaperProjectCommand[] = [{ type: 'layer/replace', compositionId, layer: replaceMotionLayerProperty(layer, options.propertyPath, property) }];
	applyMotionscaperCommands(project, commands); return freezeMotionValue(commands);
}
