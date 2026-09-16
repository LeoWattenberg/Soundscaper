/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FrameCanonicalRateStretchPlan } from '../../../../frame-canonical-rate-stretch-domain.ts'; import { setLocalizedStatus } from '../../../../../i18n/presentation-message.ts';
import { formatPlaybackRate } from '../../../shared/app-helpers.ts';
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
	setStatus(message: string, state: 'info' | 'success', localization?: import('../../../../../i18n/presentation-message.ts').LocalizedPresentationMessage): void;
}

/** Format only a completed rate-stretch commit or planned no-op. */
export function createVideoRateStretchResultReporter(
	dependencies: VideoRateStretchFeedbackDependencies,
): VideoRateStretchResultReporter {
	return (plan: FrameCanonicalRateStretchPlan): void => {
		if (plan.kind === 'noop') {
			setLocalizedStatus(dependencies.setStatus, dependencies.copy, "noRateStretchAvailable", undefined, 'info');
			return;
		}
		setLocalizedStatus(dependencies.setStatus, dependencies.copy,
			plan.edge === 'left' ? 'rateStretchLeftEdgeApplied' : 'rateStretchRightEdgeApplied', {
				rate: formatPlaybackRate(plan.authorityPlaybackRate),
				timecode: dependencies.label(plan.boundarySample, plan.authoritySequenceId),
			}, 'success', plan.clamped ? { append: [' ', { key: 'rateStretchBoundaryClamped' }] } : undefined);
	};
}
