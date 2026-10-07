/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { FRAMESCAPER_IMAGE_TICKS_PER_SECOND, normalizeFramescaperImageClipV1 } from '../common/editor/timeline-image-model.ts';
import { sampleFrameToVideoFrame } from '../common/editor/timeline-time.ts';
import type { FramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';
import type { FramescaperProjectCommandTimelineImage } from './editor-project-timeline-image-commands.ts';
import type { FramescaperImageClipSetCommandTimelineImage } from './editor-project-timeline-image-image-command.ts';

/** Split images on the sequence clock before native A/V segmentation omits them. */
export function prepareTimelineImageSplitCommand(project: FramescaperProjectTimelineImage,
	command: FramescaperProjectCommandTimelineImage): FramescaperProjectCommandTimelineImage {
	const clips = new Map(project.clips.filter(clip => clip.kind === 'image')
		.map(clip => [clip.id, normalizeFramescaperImageClipV1(clip)]));
	const owners = new Map<string, string>(project.tracks.flatMap(track => (Array.isArray(track.clipIds)
		? track.clipIds : []).map(clipId => [clipId, track.id] as const)));
	return visit(command);

	function visit(value: FramescaperProjectCommandTimelineImage): FramescaperProjectCommandTimelineImage {
		if (value.type === 'batch') {
			const batch = value as Readonly<{ type: 'batch'; commands: readonly FramescaperProjectCommandTimelineImage[] }>;
			return { ...batch, commands: batch.commands.map(visit) };
		}
		if (value.type === 'image-clip/set') {
			const mutation = value as FramescaperImageClipSetCommandTimelineImage;
			if (mutation.clip && mutation.placement?.scope === 'timeline') {
				clips.set(mutation.clipId, mutation.clip);
				owners.set(mutation.clipId, mutation.placement.trackId);
			} else { clips.delete(mutation.clipId); owners.delete(mutation.clipId); }
			return value;
		}
		if (value.type !== 'clip/split') return value;
		const split = value as Extract<AudioEditorCommand, { type: 'clip/split' }>;
		const expectedClip = clips.get(split.clipId);
		if (!expectedClip) return value;
		const sequence = project.sequences.find(item => item.id === expectedClip.sequenceId)!;
		const source = project.sources.find(item => item.id === expectedClip.sourceId);
		if (source?.kind !== 'image') throw new ReferenceError('An image split requires its exact source.');
		const boundary = sampleFrameToVideoFrame(split.atFrame, sequence.rate, project.sampleRate);
		const leftCount = boundary - expectedClip.sequenceStartFrame;
		if (leftCount <= 0 || leftCount >= expectedClip.sequenceFrameCount) {
			throw new RangeError('An image split must resolve inside its sequence extent.');
		}
		const elapsed = BigInt(leftCount) * BigInt(FRAMESCAPER_IMAGE_TICKS_PER_SECOND)
			* BigInt(sequence.rate.den) / BigInt(sequence.rate.num);
		const requestedTicks = BigInt(expectedClip.sourceStartTicks) + elapsed;
		const finalTick = BigInt(source.canonical.durationTicks) - 1n;
		const left = { ...expectedClip, sequenceFrameCount: leftCount };
		const right = { ...expectedClip, id: split.rightClipId, sequenceStartFrame: boundary,
			sequenceFrameCount: expectedClip.sequenceFrameCount - leftCount,
			sourceStartTicks: String(requestedTicks < finalTick ? requestedTicks : finalTick) };
		const placement = { scope: 'timeline' as const, trackId: owners.get(split.clipId)! };
		clips.set(left.id, left); clips.set(right.id, right); owners.set(right.id, placement.trackId);
		return { type: 'batch', commands: [{ type: 'image-clip/set', clipId: left.id, expectedClip,
			expectedPlacement: placement, clip: left, placement }, {
			type: 'image-clip/set', clipId: right.id, expectedClip: null, expectedPlacement: null,
			clip: right, placement,
		}] };
	}
}
