/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveRuntimeClipProjection, type RuntimeClipProject, type RuntimePersistedClip } from './runtime-clip-projection.ts';
import { sequenceFrameBoundarySample } from './sequence-frame-navigation.ts';
import type { RationalRate } from './timeline-time.ts';

export interface ClipContentProject extends RuntimeClipProject {
	readonly sampleRate: number;
}

export interface ClipContentRange {
	readonly startFrame: number;
	readonly endFrame: number;
}

export function clipContentRange(project: ClipContentProject, clip: RuntimePersistedClip): ClipContentRange | null {
	if (isFrame(clip.sequenceStartFrame) && isFrame(clip.sequenceFrameCount)) {
		const sequenceId = clip.sequenceId ?? project.primarySequenceId;
		const sequence = project.sequences?.find(candidate => candidate.id === sequenceId);
		const rate = sequence?.rate as RationalRate | undefined;
		if (!rate) throw new RangeError('Selected visual content requires its sequence rate.');
		return {
			startFrame: sequenceFrameBoundarySample(clip.sequenceStartFrame, rate, project.sampleRate),
			endFrame: sequenceFrameBoundarySample(clip.sequenceStartFrame + clip.sequenceFrameCount, rate, project.sampleRate),
		};
	}
	if (clip.anchor === 'musical') {
		return projectedClipContentRange(project, clip);
	}
	return isFrame(clip.timelineStartFrame) && isFrame(clip.durationFrames)
		? { startFrame: clip.timelineStartFrame, endFrame: clip.timelineStartFrame + clip.durationFrames } : null;
}

function projectedClipContentRange(project: ClipContentProject, clip: RuntimePersistedClip): ClipContentRange {
	const resolved = resolveRuntimeClipProjection(project, clip);
	return { startFrame: resolved.timelineStartFrame, endFrame: resolved.timelineEndFrame };
}

function isFrame(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}
