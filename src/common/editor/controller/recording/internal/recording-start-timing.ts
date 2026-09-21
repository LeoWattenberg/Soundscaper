/* SPDX-License-Identifier: AGPL-3.0-only */

import { calculateAudioEditorCountInFrames } from '../../transport/transport-model.ts';
import { countInSampleFrames, secondsToSampleFrame } from '../../../timeline-time.ts';
import type { RecordingProject } from '../recording-transaction-types.ts';

export interface RecordingStartTimingRequest {
	readonly project: RecordingProject;
	readonly timedStartTimeMs: number | null;
	readonly currentTimeMs: number;
	readonly contextCurrentTime: number;
	readonly projectSampleRate: number;
	readonly contextSampleRate: number;
	readonly requestedStartFrame: number;
	readonly leadInEnabled: boolean;
	readonly createTimedRecordingPastError: () => Error;
}

export interface RecordingStartTimingPlan {
	readonly scheduledTime: number;
	readonly availableLeadInFrames: number;
	readonly seekFrame: number;
	readonly captureStartFrame: (contextStartTime: number) => number;
}

/** Resolve the timing shared by legacy and routed recording starts. */
export function planRecordingStartTiming({
	project,
	timedStartTimeMs,
	currentTimeMs,
	contextCurrentTime,
	projectSampleRate,
	contextSampleRate,
	requestedStartFrame,
	leadInEnabled,
	createTimedRecordingPastError,
}: RecordingStartTimingRequest): RecordingStartTimingPlan {
	const remainingSeconds = timedStartTimeMs === null
		? null
		: (timedStartTimeMs - currentTimeMs) / 1_000;
	if (remainingSeconds !== null && remainingSeconds <= 0) {
		throw createTimedRecordingPastError();
	}
	const scheduledTime = remainingSeconds === null
		? contextCurrentTime + 0.08
		: contextCurrentTime + remainingSeconds;
	const leadInFrames = remainingSeconds === null && leadInEnabled
		? project.tempoMap != null || project.signatureMap != null
			? calculateAudioEditorCountInFrames({
				tempoMap: project.tempoMap,
				signatureMap: project.signatureMap,
				sampleRate: projectSampleRate,
				positionFrame: requestedStartFrame,
			})
			: countInSampleFrames(1, {
				bpm: Math.max(1, Number(project.tempo?.bpm) || 120),
				timeSignature: {
					numerator: Math.max(1, Number(project.tempo?.timeSignature?.numerator) || 4),
					denominator: Math.max(1, Number(project.tempo?.timeSignature?.denominator) || 4),
				},
			}, projectSampleRate)
		: 0;
	const availableLeadInFrames = Math.min(leadInFrames, requestedStartFrame);
	return Object.freeze({
		scheduledTime,
		availableLeadInFrames,
		seekFrame: requestedStartFrame - availableLeadInFrames,
		captureStartFrame: (contextStartTime: number) => secondsToSampleFrame(
			contextStartTime + availableLeadInFrames / projectSampleRate,
			contextSampleRate,
			'enclosingEnd',
		),
	});
}
