/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FrameCanonicalRollRippleTrimPlan } from '../../../../frame-canonical-roll-ripple-trim-domain.ts'; import { setLocalizedStatus } from '../../../../../i18n/presentation-message.ts';
import type { VideoRollRippleTrimResultReporter } from './video-roll-ripple-trim-service.ts';

export interface VideoRollRippleTrimFeedbackCopy {
	readonly rollLeftEdgeApplied: string;
	readonly rollRightEdgeApplied: string;
	readonly rippleLeftEdgeApplied: string;
	readonly rippleRightEdgeApplied: string;
	readonly trimBoundaryClamped: string;
	readonly noTrimAvailable: string;
}

export interface VideoRollRippleTrimFeedbackDependencies {
	readonly copy: VideoRollRippleTrimFeedbackCopy;
	label(sample: number, sequenceId?: string): string;
	setStatus(message: string, state: 'info' | 'success', localization?: import('../../../../../i18n/presentation-message.ts').LocalizedPresentationMessage): void;
}

/** Format only completed roll/ripple outcomes through the existing status path. */
export function createVideoRollRippleTrimResultReporter(
	dependencies: VideoRollRippleTrimFeedbackDependencies,
): VideoRollRippleTrimResultReporter {
	return (plan: FrameCanonicalRollRippleTrimPlan): void => {
		if (plan.kind === 'noop') {
			setLocalizedStatus(dependencies.setStatus, dependencies.copy, "noTrimAvailable", undefined, 'info');
			return;
		}
		const key = plan.mode === 'roll'
			? plan.edge === 'left' ? 'rollLeftEdgeApplied' : 'rollRightEdgeApplied'
			: plan.edge === 'left' ? 'rippleLeftEdgeApplied' : 'rippleRightEdgeApplied';
		setLocalizedStatus(dependencies.setStatus, dependencies.copy, key, {
			frames: signedFrames(plan.sequenceFrameDelta),
			sourceTimecode: dependencies.label(plan.resolvedSourceCutSample, plan.sequenceId),
			programTimecode: dependencies.label(plan.programEditSample, plan.sequenceId),
		}, 'success', plan.clamped ? { append: [' ', { key: 'trimBoundaryClamped' }] } : undefined);
	};
}

function signedFrames(value: number): string {
	return value > 0 ? `+${String(value)}` : String(value);
}
