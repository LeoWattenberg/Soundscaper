/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveRuntimeClipProjection } from '../runtime-clip-projection.ts';
import { keyboardClipMoveFrame } from '../keyboard-clip-move.ts';
import { sequenceFrameAtSample, sequenceFrameBoundarySample, snapSampleToSequenceFrame } from '../sequence-frame-navigation.ts';
import type { RationalRate } from '../timeline-time.ts';
import type { ControllerClip, ControllerProject } from '../controller/track-audio/track-domain-types.ts';

/** Contextual item keys read authored clocks before requesting sample-domain edits. */
export function itemNavigationClipGeometry(project: ControllerProject, clip: ControllerClip): ControllerClip {
	if (typeof clip.sequenceStartFrame === 'number' && typeof clip.sequenceFrameCount === 'number') {
		const sequences = project.sequences as readonly Readonly<{ id: string; rate: RationalRate }>[];
		const sequence = sequences.find(candidate => candidate.id === (clip.sequenceId ?? project.primarySequenceId));
		if (!sequence) throw new RangeError('Native item navigation requires its owning sequence.');
		const startFrame = sequenceFrameBoundarySample(clip.sequenceStartFrame, sequence.rate, project.sampleRate);
		const endFrame = sequenceFrameBoundarySample(clip.sequenceStartFrame + clip.sequenceFrameCount, sequence.rate, project.sampleRate);
		return { ...clip, timelineStartFrame: startFrame, durationFrames: endFrame - startFrame };
	}
	return clip.anchor === 'musical' ? projectedItemClipGeometry(project, clip) : clip;
}

function projectedItemClipGeometry(project: ControllerProject, clip: ControllerClip): ControllerClip {
	return resolveRuntimeClipProjection(project, clip);
}

/** Quantize the step once so opposite keys remain inverse on native frame grids. */
export function itemNavigationMoveFrame(project: ControllerProject, clip: ControllerClip, deltaFrames: number): number {
	const geometry = itemNavigationClipGeometry(project, clip);
	const snap = project.snap;
	if (deltaFrames && snap && typeof snap === 'object' && 'enabled' in snap && snap.enabled === true) {
		return keyboardClipMoveFrame(project, geometry.timelineStartFrame, deltaFrames);
	}
	if (typeof clip.sequenceStartFrame === 'number') {
		const sequences = project.sequences as readonly Readonly<{ id: string; rate: RationalRate }>[];
		const sequence = sequences.find(candidate => candidate.id === (clip.sequenceId ?? project.primarySequenceId));
		if (!sequence) throw new RangeError('Native item movement requires its owning sequence.');
		const snappedStep = snapSampleToSequenceFrame(Math.abs(deltaFrames), sequence.rate, project.sampleRate);
		const step = deltaFrames === 0 ? 0 : Math.max(1, sequenceFrameAtSample(snappedStep, sequence.rate, project.sampleRate));
		return sequenceFrameBoundarySample(Math.max(0, clip.sequenceStartFrame + Math.sign(deltaFrames) * step), sequence.rate, project.sampleRate);
	}
	return Math.max(0, geometry.timelineStartFrame + deltaFrames);
}
