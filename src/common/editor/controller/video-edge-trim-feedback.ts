/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FrameCanonicalEdgeTrimPlan } from '../frame-canonical-edge-trim-domain.ts';

export interface VideoEdgeTrimFeedbackCopy {
	readonly trimLeftEdgeApplied: string;
	readonly trimRightEdgeApplied: string;
	readonly trimBoundaryClamped: string;
	readonly noTrimAvailable: string;
}

export interface VideoEdgeTrimFeedbackDependencies {
	readonly copy: VideoEdgeTrimFeedbackCopy;
	label(sample: number, sequenceId?: string): string;
	setStatus(message: string, state: 'info' | 'success'): void;
}

export type VideoEdgeTrimResultReporter = (plan: FrameCanonicalEdgeTrimPlan) => void;

/** Format only completed controller outcomes through the existing status path. */
export function createVideoEdgeTrimResultReporter(
	dependencies: VideoEdgeTrimFeedbackDependencies,
): VideoEdgeTrimResultReporter {
	return (plan: FrameCanonicalEdgeTrimPlan): void => {
		if (plan.kind === 'noop') {
			dependencies.setStatus(dependencies.copy.noTrimAvailable, 'info');
			return;
		}
		const template = plan.edge === 'left'
			? dependencies.copy.trimLeftEdgeApplied
			: dependencies.copy.trimRightEdgeApplied;
		const message = template.replace(
			'{timecode}',
			dependencies.label(plan.boundarySample, plan.sequenceId),
		);
		dependencies.setStatus(
			plan.clamped ? `${message} ${dependencies.copy.trimBoundaryClamped}` : message,
			'success',
		);
	};
}
