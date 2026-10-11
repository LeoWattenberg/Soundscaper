/* SPDX-License-Identifier: AGPL-3.0-only */
import { compareRationals, divideRationals, multiplyRationals, type Rational } from '../common/editor/timeline-time.ts';
import { freezeMotionValue, motionId } from '../common/editor/motion-values.ts';
import { createMotionLayer, createMotionscaperProject } from './editor-project.ts';
import { normalizeMotionscaperProject } from './editor-project-validation.ts';
import { applyMotionscaperCommands, type MotionscaperProjectCommand } from './editor-project-commands.ts';
export interface MotionCompositionSettings { readonly name: string; readonly width: number; readonly height: number; readonly frameRate: Rational; readonly durationFrames: number }
export type MotionscaperCompositionEdit =
	| { readonly type: 'add'; readonly id: string; readonly settings: MotionCompositionSettings }
	| { readonly type: 'settings'; readonly compositionId: string; readonly settings: MotionCompositionSettings }
	| { readonly type: 'remove'; readonly compositionId: string }
	| { readonly type: 'primary'; readonly compositionId: string }
	| { readonly type: 'nest'; readonly compositionId: string; readonly sourceCompositionId: string; readonly layerId: string };
/** Composition identity, nested timing and all dependent layer references remain one validated transaction. */
export function createMotionscaperCompositionCommands(options: Readonly<{ project: unknown; edit: MotionscaperCompositionEdit }>): readonly MotionscaperProjectCommand[] {
	const project = normalizeMotionscaperProject(options.project); const edit = options.edit; let commands: readonly MotionscaperProjectCommand[];
	if (edit.type === 'add') {
		const composition = createMotionscaperProject({ ...edit.settings, title: edit.settings.name, compositionId: edit.id, id: project.id, sampleRate: project.sampleRate }).compositions[0]!;
		commands = [{ type: 'composition/add', composition }];
	} else {
		const compositionId = motionId(edit.compositionId); const composition = project.compositions.find(({ id }) => id === compositionId);
		if (!composition) throw new ReferenceError(`Motion composition ${compositionId} is missing.`);
		if (edit.type === 'settings') commands = [{ type: 'composition/replace', composition: { ...composition, ...edit.settings } }];
		else if (edit.type === 'remove' || edit.type === 'primary') commands = [{ type: edit.type === 'remove' ? 'composition/remove' : 'composition/set-primary', compositionId }];
		else {
			const source = project.compositions.find(({ id }) => id === motionId(edit.sourceCompositionId));
			if (!source) throw new ReferenceError('The precomposition source is missing.');
			const sourceEnd = multiplyRationals(divideRationals(source.durationFrames, source.frameRate), composition.frameRate);
			const layer = createMotionLayer({ id: edit.layerId, name: source.name, durationFrames: composition.durationFrames, content: { kind: 'precomp', compositionId: source.id } });
			commands = [{ type: 'layer/add', compositionId, index: 0, layer: { ...layer, outFrame: compareRationals(sourceEnd, composition.durationFrames) < 0 ? sourceEnd : layer.outFrame } }];
		}
	}
	applyMotionscaperCommands(project, commands); return freezeMotionValue(commands);
}
