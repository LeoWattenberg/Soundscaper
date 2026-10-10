/* SPDX-License-Identifier: AGPL-3.0-only */

import { createMotionSceneEvaluator, type MotionSceneEvaluator } from '../common/editor/motion-composition-evaluation.ts';
import { normalizeMotionscaperProject } from './editor-project-validation.ts';

/** A compiled generation owns a detached immutable project, independent of later edits. */
export function compileMotionscaperProject(value: unknown): MotionSceneEvaluator {
	const project = normalizeMotionscaperProject(value);
	return createMotionSceneEvaluator({ compositions: project.compositions, assets: project.assets, sampleRate: project.sampleRate });
}
