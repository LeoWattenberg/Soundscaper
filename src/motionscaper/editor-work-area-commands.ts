/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeMotionWorkArea, type MotionWorkArea } from '../common/editor/motion-composition-work-area.ts';
import { freezeMotionValue, motionId } from '../common/editor/motion-values.ts';
import { normalizeMotionscaperProject } from './editor-project-validation.ts';
import { applyMotionscaperCommands, type MotionscaperProjectCommand } from './editor-project-commands.ts';

export function createMotionscaperWorkAreaCommands(options: Readonly<{ project: unknown; compositionId: string; workArea: MotionWorkArea | null }>): readonly MotionscaperProjectCommand[] {
	const project = normalizeMotionscaperProject(options.project); const compositionId = motionId(options.compositionId);
	const current = project.compositions.find(({ id }) => id === compositionId); if (!current) throw new ReferenceError(`Motion composition ${compositionId} is missing.`);
	const { workArea: _workArea, ...composition } = current;
	const commands: readonly MotionscaperProjectCommand[] = [{ type: 'composition/replace', composition: options.workArea === null ? composition : { ...composition, workArea: normalizeMotionWorkArea(options.workArea, current.durationFrames) } }];
	applyMotionscaperCommands(project, commands); return freezeMotionValue(commands);
}
