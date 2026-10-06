/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeFramescaperImageClipV1, type FramescaperImageClipV1 } from '../common/editor/timeline-image-model.ts';
import { sampleFrameToVideoFrame } from '../common/editor/timeline-time.ts';
import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import type { FramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';
import type { FramescaperProjectCommandBatchTimelineImage, FramescaperProjectCommandTimelineImage } from './editor-project-timeline-image-commands.ts';

/** Translate the timeline's ordinary image moves into its existing exact image mutation command. */
export function prepareTimelineImageMoveCommand(project: FramescaperProjectTimelineImage,
	command: FramescaperProjectCommandTimelineImage): FramescaperProjectCommandTimelineImage {
	const clips = new Map(project.clips.filter(clip => clip.kind === 'image')
		.map(clip => [clip.id, normalizeFramescaperImageClipV1(clip)]));
	const owners = new Map<string, string>(project.tracks.flatMap(track => (Array.isArray(track.clipIds)
		? track.clipIds as readonly string[] : []).map(clipId => [clipId, track.id] as const)));
	return visit(command);

	function visit(value: FramescaperProjectCommandTimelineImage): FramescaperProjectCommandTimelineImage {
		if (value.type === 'batch') {
			const batch = value as FramescaperProjectCommandBatchTimelineImage;
			return { ...batch, commands: batch.commands.map(visit) };
		}
		if (value.type === 'clip/move') {
			const movement = value as Extract<AudioEditorCommand, { readonly type: 'clip/move' }>;
			if (clips.has(movement.clipId)) return move(movement.clipId, movement.timelineStartFrame, movement.trackId);
		}
		if (value.type !== 'clip/transform-many') return value;
		const movement = value as Extract<AudioEditorCommand, { readonly type: 'clip/transform-many' }>;
		const images = movement.transforms.filter(transform => clips.has(transform.clipId));
		if (!images.length) return value;
		if (movement.overwrite) throw new RangeError('Still image moves cannot overwrite other media.');
		const inherited = movement.transforms.filter(transform => !clips.has(transform.clipId));
		const commands: FramescaperProjectCommandTimelineImage[] = inherited.length
			? [{ ...movement, transforms: inherited }] : [];
		for (const transform of images) {
			if (Object.keys(transform.changes).some(key => key !== 'timelineStartFrame')) {
				throw new RangeError('This still image transform requires an image-specific editing operation.');
			}
			commands.push(move(transform.clipId, transform.changes.timelineStartFrame, transform.trackId));
		}
		return { type: 'batch', commands };
	}

	function move(clipId: string, startFrame: unknown, requestedTrackId?: string): FramescaperProjectCommandTimelineImage {
		const expectedClip = clips.get(clipId)!;
		const owner = owners.get(clipId);
		if (!owner) throw new ReferenceError('A timeline image move requires a timeline track owner.');
		const trackId = requestedTrackId ?? owner;
		const sequence = project.sequences.find(item => item.trackIds.includes(trackId))
			?? project.sequences.find(item => item.id === expectedClip.sequenceId);
		if (!sequence) throw new ReferenceError('A timeline image move requires its exact sequence clock.');
		const clip: FramescaperImageClipV1 = { ...expectedClip, sequenceId: sequence.id,
			sequenceStartFrame: startFrame === undefined ? expectedClip.sequenceStartFrame
				: sampleFrameToVideoFrame(Number(startFrame), sequence.rate, project.sampleRate, 'point') };
		clips.set(clipId, clip);
		owners.set(clipId, trackId);
		return { type: 'image-clip/set', clipId, expectedClip,
			expectedPlacement: { scope: 'timeline', trackId: owner }, clip,
			placement: { scope: 'timeline', trackId } };
	}
}
