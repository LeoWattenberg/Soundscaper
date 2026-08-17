/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	type MasteringSequenceRegionView,
	type MasteringSequenceV23,
	type MasteringSequenceValidation,
	validateMasteringSequenceV23,
} from './mastering-sequence.ts';
import {
	type RuntimeTimelineAnnotationProject,
	resolveRuntimeTimelineAnnotationsProjection,
} from './runtime-timeline-annotation-projection.ts';

/**
 * The bridge from V11 annotations to the regions a mastering sequence refers to.
 *
 * This is the only place a sequence ever learns where its regions are, and it
 * learns it from the runtime annotation projection rather than by reading
 * coordinates itself. That matters more than it looks: regions may be anchored
 * musically, so "where does this region start in frames" is a question only the
 * project's tempo map can answer, and resolving it a second time here would be a
 * second timing authority that drifts from the first.
 *
 * Markers are dropped rather than reported. A marker is a point, and a mastering
 * sequence delivers extents — an entry pointing at one simply finds no region,
 * which validation already reports as a missing region with the entry intact.
 */

export function masteringSequenceRegionViews(
	project: RuntimeTimelineAnnotationProject,
): readonly MasteringSequenceRegionView[] {
	return Object.freeze(resolveRuntimeTimelineAnnotationsProjection(project)
		.filter((annotation) => annotation.kind === 'region')
		.map((annotation) => Object.freeze({
			id: annotation.id,
			sequenceId: annotation.sequenceId,
			name: annotation.name,
			startFrame: annotation.timelineStartFrame,
			endFrame: annotation.timelineEndFrame,
		})));
}

/** Validate one sequence against the project it lives in. */
export function validateProjectMasteringSequence(
	project: RuntimeTimelineAnnotationProject,
	sequence: MasteringSequenceV23,
): MasteringSequenceValidation {
	return validateMasteringSequenceV23(sequence, masteringSequenceRegionViews(project));
}
