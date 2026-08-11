/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FrameCanonicalSlipSlidePlan } from '../frame-canonical-slip-slide-domain.ts';
import type { VideoSlipSlideResultReporter } from './video-slip-slide-service.ts';

export interface VideoSlipSlideFeedbackCopy {
	readonly slipApplied: string;
	readonly slideApplied: string;
	readonly trimBoundaryClamped: string;
	readonly noTrimAvailable: string;
}

export interface VideoSlipSlideFeedbackDependencies {
	readonly copy: VideoSlipSlideFeedbackCopy;
	sourceLabel(sourceId: string, sourceFrame: number): string;
	programLabel(sample: number, sequenceId?: string): string;
	setStatus(message: string, state: 'info' | 'success'): void;
}

/** Format only completed slip/slide outcomes through the existing status path. */
export function createVideoSlipSlideResultReporter(
	dependencies: VideoSlipSlideFeedbackDependencies,
): VideoSlipSlideResultReporter {
	return (plan: FrameCanonicalSlipSlidePlan): void => {
		if (plan.kind === 'noop') {
			dependencies.setStatus(dependencies.copy.noTrimAvailable, 'info');
			return;
		}
		const message = plan.mode === 'slip'
			? replaceValues(dependencies.copy.slipApplied, {
				frames: signedFrames(plan.sourceFrameDelta),
				sourceTimecode: dependencies.sourceLabel(
					plan.authoritySourceId,
					plan.appliedSourceInFrame,
				),
			})
			: replaceValues(dependencies.copy.slideApplied, {
				frames: signedFrames(plan.sequenceFrameDelta),
				programStartTimecode: dependencies.programLabel(
					plan.appliedStartSample,
					plan.authoritySequenceId,
				),
				programEndTimecode: dependencies.programLabel(
					plan.appliedEndSample,
					plan.authoritySequenceId,
				),
			});
		dependencies.setStatus(
			plan.clamped ? `${message} ${dependencies.copy.trimBoundaryClamped}` : message,
			'success',
		);
	};
}

function signedFrames(value: number): string {
	return value > 0 ? `+${String(value)}` : String(value);
}

function replaceValues(template: string, values: Readonly<Record<string, string>>): string {
	return Object.entries(values).reduce(
		(message, [key, value]) => message.replaceAll(`{${key}}`, value),
		template,
	);
}
