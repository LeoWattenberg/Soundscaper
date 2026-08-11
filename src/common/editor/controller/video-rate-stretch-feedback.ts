/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FrameCanonicalRateStretchPlan } from '../frame-canonical-rate-stretch-domain.ts';
import { formatPlaybackRate } from './app-helpers.ts';
import type { VideoRateStretchResultReporter } from './video-rate-stretch-service.ts';

export interface VideoRateStretchFeedbackCopy {
	readonly rateStretchLeftEdgeApplied: string;
	readonly rateStretchRightEdgeApplied: string;
	readonly rateStretchBoundaryClamped: string;
	readonly noRateStretchAvailable: string;
}

export interface VideoRateStretchFeedbackDependencies {
	readonly copy: VideoRateStretchFeedbackCopy;
	label(sample: number, sequenceId?: string): string;
	setStatus(message: string, state: 'info' | 'success'): void;
}

/** Format only a completed rate-stretch commit or planned no-op. */
export function createVideoRateStretchResultReporter(
	dependencies: VideoRateStretchFeedbackDependencies,
): VideoRateStretchResultReporter {
	return (plan: FrameCanonicalRateStretchPlan): void => {
		if (plan.kind === 'noop') {
			dependencies.setStatus(dependencies.copy.noRateStretchAvailable, 'info');
			return;
		}
		const template = plan.edge === 'left'
			? dependencies.copy.rateStretchLeftEdgeApplied
			: dependencies.copy.rateStretchRightEdgeApplied;
		const message = replaceValues(template, {
			rate: formatPlaybackRate(plan.authorityPlaybackRate),
			timecode: dependencies.label(plan.boundarySample, plan.authoritySequenceId),
		});
		dependencies.setStatus(
			plan.clamped
				? `${message} ${dependencies.copy.rateStretchBoundaryClamped}`
				: message,
			'success',
		);
	};
}

function replaceValues(template: string, values: Readonly<Record<string, string>>): string {
	return Object.entries(values).reduce(
		(message, [key, value]) => message.replaceAll(`{${key}}`, value),
		template,
	);
}
