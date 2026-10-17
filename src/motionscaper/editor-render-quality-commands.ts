/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeMotionTemporalSettings, motionDepthOfFieldSamples, type MotionTemporalSettings } from '../common/editor/motion-temporal-settings.ts';
import { freezeMotionValue, motionId } from '../common/editor/motion-values.ts';
import { normalizeMotionscaperProject } from './editor-project-validation.ts';
import { applyMotionscaperCommands, type MotionscaperProjectCommand } from './editor-project-commands.ts';

/** Null removes authored quality; omission leaves that independent setting unchanged. */
export function createMotionscaperRenderQualityCommands(options: Readonly<{
	project: unknown; compositionId: string; temporal?: MotionTemporalSettings | null; depthOfFieldSamples?: number | null;
}>): readonly MotionscaperProjectCommand[] {
	const project = normalizeMotionscaperProject(options.project); const id = motionId(options.compositionId);
	const current = project.compositions.find(composition => composition.id === id); if (!current) throw new ReferenceError(`Motion composition ${id} is missing.`);
	const { temporal, depthOfFieldSamples, ...base } = current;
	const nextTemporal = options.temporal === undefined ? temporal : options.temporal === null ? undefined : normalizeMotionTemporalSettings(options.temporal);
	const nextDepth = options.depthOfFieldSamples === undefined ? depthOfFieldSamples : options.depthOfFieldSamples === null ? undefined : motionDepthOfFieldSamples(options.depthOfFieldSamples);
	const commands: readonly MotionscaperProjectCommand[] = [{ type: 'composition/replace', composition: { ...base,
		...(nextTemporal ? { temporal: nextTemporal } : {}), ...(nextDepth === undefined ? {} : { depthOfFieldSamples: nextDepth }) } }];
	applyMotionscaperCommands(project, commands); return freezeMotionValue(commands);
}
