/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	deepFreeze,
	frameTrimRecord,
	indexFrameTrimProject,
	nonEmptyString,
	safeAdd,
} from './frame-canonical-edge-trim-domain.ts';
import type {
	FrameCanonicalSlipSlideMode,
	FrameCanonicalSlipSlideRequest,
} from './frame-canonical-slip-slide-domain.ts';
import {
	resolveFrameCanonicalSlideTargets,
	resolveFrameCanonicalSlipTargets,
} from './frame-canonical-slip-slide-targets.ts';
import {
	frameCanonicalTrimParticipant,
	frameCanonicalVideoAuthority,
} from './frame-canonical-trim-planning.ts';
import { isRuntimeProjectProjection } from './runtime-clip-projection.ts';
import { videoFrameToSampleFrame } from './timeline-time.ts';

export type FrameCanonicalSlipSlideStepDirection = 'earlier' | 'later';

export interface FrameCanonicalSlipSlideStep {
	readonly mode: FrameCanonicalSlipSlideMode;
	readonly activeClipId: string;
	readonly direction: FrameCanonicalSlipSlideStepDirection;
}

/** Resolve one absolute one-frame request from the planner's immutable video authority. */
export function buildFrameCanonicalSlipSlideStepRequest(
	projectValue: unknown,
	step: FrameCanonicalSlipSlideStep,
): Readonly<FrameCanonicalSlipSlideRequest> {
	if (!isRuntimeProjectProjection(projectValue)) {
		throw new TypeError('A frame-canonical slip/slide step requires the branded command projection.');
	}
	const project = frameTrimRecord(projectValue, 'project');
	const mode = slipSlideMode(step?.mode);
	const activeClipId = nonEmptyString(step?.activeClipId, 'step.activeClipId');
	const direction = stepDirection(step?.direction);
	const delta = direction === 'earlier' ? -1 : 1;
	const index = indexFrameTrimProject(project);
	const active = frameCanonicalTrimParticipant(index, activeClipId);
	if (mode === 'slip') {
		const targets = resolveFrameCanonicalSlipTargets(project, index, activeClipId);
		const authority = frameCanonicalVideoAuthority(
			active.clip,
			targets.participants.filter(({ video }) => video !== null),
		);
		return deepFreeze({
			mode,
			activeClipId,
			requestedSourceInFrame: safeAdd(
				authority.video!.sourceIn,
				delta,
				'slip step source-in frame',
			),
		});
	}
	const targets = resolveFrameCanonicalSlideTargets(project, index, activeClipId);
	const authority = frameCanonicalVideoAuthority(
		active.clip,
		targets.center.filter(({ video }) => video !== null),
	);
	const video = authority.video!;
	const requestedSequenceStartFrame = safeAdd(
		video.sequenceStart,
		delta,
		'slide step sequence start',
	);
	return deepFreeze({
		mode,
		activeClipId,
		requestedStartSample: videoFrameToSampleFrame(
			requestedSequenceStartFrame,
			video.sequenceRate,
			index.sampleRate,
			'point',
		),
	});
}

function slipSlideMode(value: unknown): FrameCanonicalSlipSlideMode {
	if (value !== 'slip' && value !== 'slide') {
		throw new RangeError(`Unsupported slip/slide step mode: ${String(value)}.`);
	}
	return value;
}

function stepDirection(value: unknown): FrameCanonicalSlipSlideStepDirection {
	if (value !== 'earlier' && value !== 'later') {
		throw new RangeError(`Unsupported slip/slide step direction: ${String(value)}.`);
	}
	return value;
}
