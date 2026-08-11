/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FrameCanonicalRollRippleTrimPlan } from '../frame-canonical-roll-ripple-trim-domain.ts';
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
	setStatus(message: string, state: 'info' | 'success'): void;
}

/** Format only completed roll/ripple outcomes through the existing status path. */
export function createVideoRollRippleTrimResultReporter(
	dependencies: VideoRollRippleTrimFeedbackDependencies,
): VideoRollRippleTrimResultReporter {
	return (plan: FrameCanonicalRollRippleTrimPlan): void => {
		if (plan.kind === 'noop') {
			dependencies.setStatus(dependencies.copy.noTrimAvailable, 'info');
			return;
		}
		const sourceTimecode = dependencies.label(plan.resolvedSourceCutSample, plan.sequenceId);
		const programTimecode = dependencies.label(plan.programEditSample, plan.sequenceId);
		const message = replaceValues(template(dependencies.copy, plan), {
			frames: signedFrames(plan.sequenceFrameDelta),
			sourceTimecode,
			programTimecode,
		});
		dependencies.setStatus(
			plan.clamped ? `${message} ${dependencies.copy.trimBoundaryClamped}` : message,
			'success',
		);
	};
}

function template(
	copy: VideoRollRippleTrimFeedbackCopy,
	plan: FrameCanonicalRollRippleTrimPlan,
): string {
	if (plan.mode === 'roll') {
		return plan.edge === 'left' ? copy.rollLeftEdgeApplied : copy.rollRightEdgeApplied;
	}
	return plan.edge === 'left' ? copy.rippleLeftEdgeApplied : copy.rippleRightEdgeApplied;
}

function signedFrames(value: number): string {
	return value > 0 ? `+${String(value)}` : String(value);
}

function replaceValues(templateValue: string, values: Readonly<Record<string, string>>): string {
	return Object.entries(values).reduce(
		(message, [key, value]) => message.replaceAll(`{${key}}`, value),
		templateValue,
	);
}
