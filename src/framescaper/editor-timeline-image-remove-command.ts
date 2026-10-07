/* SPDX-License-Identifier: AGPL-3.0-only */

import { collectRelatedClipIds } from '../common/editor/commands/editing-selection-authority.ts';
import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { normalizeFramescaperImageClipV1 } from '../common/editor/timeline-image-model.ts';
import { videoFrameToSampleFrame } from '../common/editor/timeline-time.ts';
import type { FramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';
import type { FramescaperProjectCommandTimelineImage } from './editor-project-timeline-image-commands.ts';
import type { FramescaperImageClipSetCommandTimelineImage } from './editor-project-timeline-image-image-command.ts';

/** Preserve the ordinary removal semantics before inherited editing drops image leaves. */
export function prepareTimelineImageRemoveCommand(project: FramescaperProjectTimelineImage,
	command: FramescaperProjectCommandTimelineImage): FramescaperProjectCommandTimelineImage {
	const clips = new Map(project.clips.map(clip => [clip.id, clip]));
	const owners = new Map<string, string>(project.tracks.flatMap(track => (Array.isArray(track.clipIds)
		? track.clipIds : []).map(clipId => [clipId, track.id] as const)));
	let selection = project.selection;
	return visit(command);

	function visit(value: FramescaperProjectCommandTimelineImage): FramescaperProjectCommandTimelineImage {
		if (value.type === 'batch') {
			const batch = value as Readonly<{ type: 'batch'; commands: readonly FramescaperProjectCommandTimelineImage[] }>;
			return { ...batch, commands: batch.commands.map(visit) };
		}
		if (value.type === 'image-clip/set') {
			const mutation = value as FramescaperImageClipSetCommandTimelineImage;
			if (mutation.clip && mutation.placement?.scope === 'timeline') {
				clips.set(mutation.clipId, { ...mutation.clip });
				owners.set(mutation.clipId, mutation.placement.trackId);
			} else { clips.delete(mutation.clipId); owners.delete(mutation.clipId); }
			return value;
		}
		if (value.type === 'selection/set') {
			const update = value as Extract<AudioEditorCommand, { type: 'selection/set' }>;
			selection = { ...selection, ...update };
			return value;
		}
		if (value.type !== 'clip/remove' && value.type !== 'clip/remove-many') return value;
		const removal = value as Extract<AudioEditorCommand, { type: 'clip/remove' | 'clip/remove-many' }>;
		const ids = collectRelatedClipIds({ ...project, clips: [...clips.values()] },
			removal.type === 'clip/remove' ? [removal.clipId] : removal.clipIds);
		const removed = new Set(ids);
		const images = ids.filter(id => clips.get(id)?.kind === 'image');
		if (!images.length) return value;
		const commands: FramescaperProjectCommandTimelineImage[] = [];
		const inherited = ids.filter(id => clips.get(id)?.kind !== 'image');
		const rippleMode = removal.type === 'clip/remove-many' ? removal.rippleMode : 'none';
		if (inherited.length) commands.push({ type: 'clip/remove-many', clipIds: inherited, rippleMode });
		for (const id of images) commands.push(imageMutation(id, null));
		if (rippleMode === 'track') for (const trackId of new Set(images.map(id => owners.get(id)))) {
			const ranges = mergeRanges(ids.filter(id => owners.get(id) === trackId).map(id => {
				const clip = clips.get(id)!;
				return { start: Number(clip.sequenceStartFrame), end: Number(clip.sequenceStartFrame) + Number(clip.sequenceFrameCount) };
			}));
			const survivors = [...clips.values()].filter(clip => owners.get(clip.id) === trackId && !removed.has(clip.id))
				.sort((left, right) => Number(left.sequenceStartFrame) - Number(right.sequenceStartFrame));
			for (const clip of survivors) {
				const start = Number(clip.sequenceStartFrame);
				const shift = ranges.reduce((sum, range) => sum + (start >= range.end ? range.end - range.start : 0), 0);
				if (!shift) continue;
				if (clip.kind === 'image') commands.push(imageMutation(clip.id, start - shift));
				else {
					const sequence = project.sequences.find(item => item.id === clip.sequenceId)!;
					commands.push({ type: 'clip/move', clipId: clip.id, timelineStartFrame:
						videoFrameToSampleFrame(start - shift, sequence.rate, project.sampleRate) });
				}
			}
		}
		for (const id of images) { clips.delete(id); owners.delete(id); }
		selection = { ...selection, clipIds: selection.clipIds.filter(id => !removed.has(id)) };
		commands.unshift({ type: 'selection/set', startFrame: selection.startFrame, endFrame: selection.endFrame,
			trackIds: selection.trackIds, clipIds: selection.clipIds });
		return { type: 'batch', commands };
	}

	function imageMutation(id: string, start: number | null): FramescaperImageClipSetCommandTimelineImage {
		const expectedClip = normalizeFramescaperImageClipV1(clips.get(id));
		const trackId = owners.get(id)!;
		const clip = start === null ? null : { ...expectedClip, sequenceStartFrame: start };
		if (clip) clips.set(id, clip);
		return { type: 'image-clip/set', clipId: id, expectedClip, expectedPlacement: { scope: 'timeline', trackId },
			clip, placement: clip ? { scope: 'timeline', trackId } : null };
	}
}

function mergeRanges(values: readonly Readonly<{ start: number; end: number }>[]) {
	const ranges: { start: number; end: number }[] = [];
	for (const value of [...values].sort((left, right) => left.start - right.start)) {
		const prior = ranges.at(-1);
		if (prior && value.start <= prior.end) prior.end = Math.max(prior.end, value.end);
		else ranges.push({ ...value });
	}
	return ranges;
}
