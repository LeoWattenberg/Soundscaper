/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FrameCanonicalSlipSlidePlan } from '../../../../frame-canonical-slip-slide-domain.ts'; import { setLocalizedStatus } from '../../../../../i18n/presentation-message.ts';
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
	setStatus(message: string, state: 'info' | 'success', localization?: import('../../../../../i18n/presentation-message.ts').LocalizedPresentationMessage): void;
}

/** Format only completed slip/slide outcomes through the existing status path. */
export function createVideoSlipSlideResultReporter(
	dependencies: VideoSlipSlideFeedbackDependencies,
): VideoSlipSlideResultReporter {
	return (plan: FrameCanonicalSlipSlidePlan): void => {
		if (plan.kind === 'noop') {
			setLocalizedStatus(dependencies.setStatus, dependencies.copy, "noTrimAvailable", undefined, 'info');
			return;
		}
		const parameters: Readonly<Record<string, string>> = plan.mode === 'slip'
			? {
				frames: signedFrames(plan.sourceFrameDelta),
				sourceTimecode: dependencies.sourceLabel(
					plan.authoritySourceId,
					plan.appliedSourceInFrame,
				),
			}
			: {
				frames: signedFrames(plan.sequenceFrameDelta),
				programStartTimecode: dependencies.programLabel(
					plan.appliedStartSample,
					plan.authoritySequenceId,
				),
				programEndTimecode: dependencies.programLabel(
					plan.appliedEndSample,
					plan.authoritySequenceId,
				),
			};
		setLocalizedStatus(dependencies.setStatus, dependencies.copy,
			plan.mode === 'slip' ? 'slipApplied' : 'slideApplied', parameters, 'success',
			plan.clamped ? { append: [' ', { key: 'trimBoundaryClamped' }] } : undefined);
	};
}

function signedFrames(value: number): string {
	return value > 0 ? `+${String(value)}` : String(value);
}
