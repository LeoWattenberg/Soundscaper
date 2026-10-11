/* SPDX-License-Identifier: AGPL-3.0-only */

import { createMotionSceneEvaluator, type MotionSceneEvaluator } from '../common/editor/motion-composition-evaluation.ts';
import { requireMotionTrackingReady } from '../common/editor/motion-tracking-admission.ts';
import { createMotionscaperRevision } from './editor-project-revision.ts';

/** A compiled generation owns a detached immutable project, independent of later edits. */
export function compileMotionscaperProject(value: unknown): MotionSceneEvaluator {
	const revision = createMotionscaperRevision(value);
	requireMotionTrackingReady(revision.project);
	return createMotionSceneEvaluator(revision.project, { revisionDigest: revision.digest });
}
