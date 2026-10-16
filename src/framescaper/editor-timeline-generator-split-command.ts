/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { normalizeVideoGeneratorClipV1, type VideoGeneratorClipV1 } from '../common/editor/video-visual-model-v24.ts';
import { sampleFrameToVideoFrame } from '../common/editor/timeline-time.ts';
import type { FramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';
import type { FramescaperProjectCommandTimelineImage, FramescaperProjectCommandBatchTimelineImage } from './editor-project-timeline-image-commands.ts';
import type { FramescaperVideoVisualClipSetCommandVisual } from './editor-project-visual-visual-command.ts';
import { createSplitVisualPresentationPlanner } from './editor-split-visual-presentations.ts';
import type { FramescaperVideoVisualPresentationSetCommandFinishing } from './editor-project-finishing-finishing-command.ts';

/** Split generated visuals before the inherited camera/audio executor omits them. */
export function prepareTimelineGeneratorSplitCommand(project: FramescaperProjectTimelineImage,
	command: FramescaperProjectCommandTimelineImage): FramescaperProjectCommandTimelineImage {
	const clips = new Map<string, VideoGeneratorClipV1>();
	for (const clip of project.clips as readonly Readonly<Record<string, unknown>>[]) {
		if (clip.kind === 'generator') clips.set(String(clip.id), normalizeVideoGeneratorClipV1(clip));
	}
	const owners = new Map(project.tracks.flatMap(track => (Array.isArray(track.clipIds)
		? track.clipIds as readonly string[] : []).map(id => [id, track.id] as const)));
	const presentations = createSplitVisualPresentationPlanner(project.videoVisualPresentations as readonly unknown[]);
	return visit(command);

	function visit(value: FramescaperProjectCommandTimelineImage): FramescaperProjectCommandTimelineImage {
		if (value.type === 'batch') return { ...value, commands: (value as FramescaperProjectCommandBatchTimelineImage).commands.map(visit) };
		if (value.type === 'video-visual-presentation/set') {
			presentations.observe(value as FramescaperVideoVisualPresentationSetCommandFinishing);
			return value;
		}
		if (value.type === 'video-visual-clip/set') {
			const mutation = value as FramescaperVideoVisualClipSetCommandVisual;
			if (mutation.clip?.kind === 'generator' && mutation.placement?.scope === 'timeline') {
				clips.set(mutation.clipId, mutation.clip); owners.set(mutation.clipId, mutation.placement.trackId);
			} else { clips.delete(mutation.clipId); owners.delete(mutation.clipId); }
			return value;
		}
		if (value.type !== 'clip/split') return value;
		const split = value as Extract<AudioEditorCommand, { type: 'clip/split' }>;
		const expectedClip = clips.get(split.clipId);
		if (!expectedClip) return value;
		const sequence = project.sequences.find(item => item.id === expectedClip.sequenceId);
		if (!sequence) throw new ReferenceError('A generated visual split requires its sequence clock.');
		const boundary = sampleFrameToVideoFrame(split.atFrame, sequence.rate, project.sampleRate, 'point');
		const leftCount = boundary - expectedClip.sequenceStartFrame;
		if (leftCount <= 0 || leftCount >= expectedClip.sequenceFrameCount) throw new RangeError('A generated visual split must be inside its sequence extent.');
		const elapsed = Math.round(leftCount * expectedClip.sourceFrameCount / expectedClip.sequenceFrameCount);
		const leftSourceCount = Math.max(1, elapsed);
		const rightSourceStart = Math.min(expectedClip.sourceInFrame + elapsed,
			expectedClip.sourceInFrame + expectedClip.sourceFrameCount - 1);
		const left = normalizeVideoGeneratorClipV1({ ...expectedClip,
			sequenceFrameCount: leftCount, sourceFrameCount: leftSourceCount });
		const right = normalizeVideoGeneratorClipV1({ ...expectedClip, id: split.rightClipId, sequenceStartFrame: boundary,
			sequenceFrameCount: expectedClip.sequenceFrameCount - leftCount, sourceInFrame: rightSourceStart,
			sourceFrameCount: expectedClip.sourceInFrame + expectedClip.sourceFrameCount - rightSourceStart });
		const trackId = owners.get(split.clipId);
		if (!trackId) throw new ReferenceError('A generated visual split requires its picture track.');
		const placement = { scope: 'timeline' as const, trackId };
		clips.set(left.id, left); clips.set(right.id, right); owners.set(right.id, trackId);
		return { type: 'batch', commands: [{ type: 'video-visual-clip/set', clipId: left.id,
			expectedClip, expectedPlacement: placement, clip: left, placement }, {
			type: 'video-visual-clip/set', clipId: right.id, expectedClip: null, expectedPlacement: null, clip: right, placement,
		}, ...presentations.copy(left.id, right.id)] };
	}
}
