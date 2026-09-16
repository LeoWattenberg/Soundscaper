/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FrameCanonicalEdgeTrimPlan } from '../../../../frame-canonical-edge-trim-domain.ts'; import { setLocalizedStatus } from '../../../../../i18n/presentation-message.ts';

export interface VideoEdgeTrimFeedbackCopy {
	readonly trimLeftEdgeApplied: string;
	readonly trimRightEdgeApplied: string;
	readonly trimBoundaryClamped: string;
	readonly noTrimAvailable: string;
}

export interface VideoEdgeTrimFeedbackDependencies {
	readonly copy: VideoEdgeTrimFeedbackCopy;
	label(sample: number, sequenceId?: string): string;
	setStatus(message: string, state: 'info' | 'success', localization?: import('../../../../../i18n/presentation-message.ts').LocalizedPresentationMessage): void;
}

export type VideoEdgeTrimResultReporter = (plan: FrameCanonicalEdgeTrimPlan) => void;

/** Format only completed controller outcomes through the existing status path. */
export function createVideoEdgeTrimResultReporter(
	dependencies: VideoEdgeTrimFeedbackDependencies,
): VideoEdgeTrimResultReporter {
	return (plan: FrameCanonicalEdgeTrimPlan): void => {
		if (plan.kind === 'noop') {
			setLocalizedStatus(dependencies.setStatus, dependencies.copy, "noTrimAvailable", undefined, 'info');
			return;
		}
		setLocalizedStatus(dependencies.setStatus, dependencies.copy,
			plan.edge === 'left' ? 'trimLeftEdgeApplied' : 'trimRightEdgeApplied',
			{ timecode: dependencies.label(plan.boundarySample, plan.sequenceId) }, 'success',
			plan.clamped ? { append: [' ', { key: 'trimBoundaryClamped' }] } : undefined);
	};
}
