/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeVideoGeneratorClipV1, normalizeVideoStillClipV1 } from '../common/editor/video-visual-model-v24.ts';
import type { VideoGeneratorClipV1, VideoStillClipV1 } from '../common/editor/video-visual-model-v24.ts';
import { sampleFrameToVideoFrame } from '../common/editor/timeline-time.ts';
import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import type { FramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';
import type { FramescaperProjectCommandTimelineImage, FramescaperProjectCommandBatchTimelineImage } from './editor-project-timeline-image-commands.ts';
import type { FramescaperVideoVisualClipSetCommandVisual } from './editor-project-visual-visual-command.ts';

/** Retain generator/still authority when the timeline requests an ordinary move. */
export function prepareTimelineVisualMoveCommand(project: FramescaperProjectTimelineImage,
	command: FramescaperProjectCommandTimelineImage): FramescaperProjectCommandTimelineImage {
	const records = project.clips as readonly Readonly<Record<string, unknown>>[];
	const clips = new Map<string, VideoGeneratorClipV1 | VideoStillClipV1>();
	for (const clip of records) {
		if (clip.kind === 'generator') clips.set(String(clip.id), normalizeVideoGeneratorClipV1(clip));
		else if (clip.kind === 'still') clips.set(String(clip.id), normalizeVideoStillClipV1(clip));
	}
	const owners = new Map(project.tracks.flatMap(track => (Array.isArray(track.clipIds)
		? track.clipIds as readonly string[] : []).map(id => [id, track.id] as const)));
	return visit(command);

	function visit(value: FramescaperProjectCommandTimelineImage): FramescaperProjectCommandTimelineImage {
		if (value.type === 'batch') return { ...value, commands: (value as FramescaperProjectCommandBatchTimelineImage).commands.map(visit) };
		if (value.type === 'video-visual-clip/set') {
			const mutation = value as FramescaperVideoVisualClipSetCommandVisual;
			if (mutation.clip && mutation.placement?.scope === 'timeline') {
				clips.set(mutation.clipId, mutation.clip); owners.set(mutation.clipId, mutation.placement.trackId);
			} else { clips.delete(mutation.clipId); owners.delete(mutation.clipId); }
			return value;
		}
		if (value.type === 'clip/move') {
			const movement = value as Extract<AudioEditorCommand, { readonly type: 'clip/move' }>;
			if (clips.has(movement.clipId)) return move(movement.clipId, movement.timelineStartFrame, movement.trackId);
		}
		if (value.type !== 'clip/transform-many') return value;
		const movement = value as Extract<AudioEditorCommand, { readonly type: 'clip/transform-many' }>;
		const visual = movement.transforms.filter(transform => clips.has(transform.clipId));
		if (!visual.length) return value;
		if (movement.overwrite) throw new RangeError('Generated visual moves cannot overwrite other media.');
		const inherited = movement.transforms.filter(transform => !clips.has(transform.clipId));
		const commands: FramescaperProjectCommandTimelineImage[] = inherited.length ? [{ ...movement, transforms: inherited }] : [];
		for (const transform of visual) {
			if (Object.keys(transform.changes).some(key => key !== 'timelineStartFrame')) {
				throw new RangeError('This generated visual transform requires its own editing operation.');
			}
			commands.push(move(transform.clipId, transform.changes.timelineStartFrame, transform.trackId));
		}
		return { type: 'batch', commands };
	}

	function move(clipId: string, startFrame: unknown, targetId?: string): FramescaperProjectCommandTimelineImage {
		const expectedClip = clips.get(clipId)!;
		const owner = owners.get(clipId);
		if (!owner) throw new ReferenceError('A generated visual move requires its timeline owner.');
		const trackId = targetId ?? owner;
		const sequence = project.sequences.find(item => item.trackIds.includes(trackId))
			?? project.sequences.find(item => item.id === expectedClip.sequenceId);
		if (!sequence) throw new ReferenceError('A generated visual move requires its sequence clock.');
		const clip = { ...expectedClip, sequenceId: sequence.id, sequenceStartFrame: startFrame === undefined
			? expectedClip.sequenceStartFrame : sampleFrameToVideoFrame(Number(startFrame), sequence.rate, project.sampleRate, 'point') };
		clips.set(clipId, clip); owners.set(clipId, trackId);
		return { type: 'video-visual-clip/set', clipId, expectedClip,
			expectedPlacement: { scope: 'timeline', trackId: owner }, clip, placement: { scope: 'timeline', trackId } };
	}
}
