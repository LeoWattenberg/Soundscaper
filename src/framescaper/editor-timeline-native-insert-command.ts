/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { normalizeFramescaperImageClipV1, type FramescaperImageClipV1 } from '../common/editor/timeline-image-model.ts';
import { sampleFrameToVideoFrame } from '../common/editor/timeline-time.ts';
import { normalizeVideoGeneratorClipV1, normalizeVideoStillClipV1,
	type VideoGeneratorClipV1, type VideoStillClipV1 } from '../common/editor/video-visual-model-v24.ts';
import type { VideoVisualPresentationV1 } from '../common/editor/video-visual-presentation-v27.ts';
import type { FramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';
import type { FramescaperProjectCommandTimelineImage, FramescaperProjectCommandBatchTimelineImage } from './editor-project-timeline-image-commands.ts';
import type { FramescaperImageClipSetCommandTimelineImage } from './editor-project-timeline-image-image-command.ts';
import type { FramescaperVideoVisualClipSetCommandVisual } from './editor-project-visual-visual-command.ts';
import type { FramescaperVideoVisualPresentationSetCommandFinishing } from './editor-project-finishing-finishing-command.ts';
import { prepareTimelineGeneratorSplitCommand } from './editor-timeline-generator-split-command.ts';
import { prepareTimelineImageSplitCommand } from './editor-timeline-image-split-command.ts';
import { createSplitVisualPresentationPlanner } from './editor-split-visual-presentations.ts';

type NativeClip = FramescaperImageClipV1 | VideoGeneratorClipV1 | VideoStillClipV1;

/** Bin Insert opens every native picture lane before inherited camera/audio execution. */
export function prepareTimelineNativeInsertCommand(project: FramescaperProjectTimelineImage,
	command: FramescaperProjectCommandTimelineImage): FramescaperProjectCommandTimelineImage {
	const clips = new Map<string, NativeClip>();
	for (const clip of project.clips as readonly Readonly<Record<string, unknown>>[]) {
		if (clip.kind === 'image') clips.set(String(clip.id), normalizeFramescaperImageClipV1(clip));
		else if (clip.kind === 'generator') clips.set(String(clip.id), normalizeVideoGeneratorClipV1(clip));
		else if (clip.kind === 'still') clips.set(String(clip.id), normalizeVideoStillClipV1(clip));
	}
	const owners = new Map(project.tracks.flatMap(track => (Array.isArray(track.clipIds)
		? track.clipIds as readonly string[] : []).map(id => [id, track.id] as const)));
	const presentations = new Map((project.videoVisualPresentations as readonly VideoVisualPresentationV1[]).map(row => [row.id, row]));
	return visit(command);

	function observe(value: FramescaperProjectCommandTimelineImage): void {
		if (value.type === 'batch') {
			for (const child of (value as FramescaperProjectCommandBatchTimelineImage).commands) observe(child);
		} else if (value.type === 'image-clip/set' || value.type === 'video-visual-clip/set') {
			const mutation = value as FramescaperImageClipSetCommandTimelineImage | FramescaperVideoVisualClipSetCommandVisual;
			if (mutation.clip && mutation.placement?.scope === 'timeline') {
				clips.set(mutation.clipId, mutation.clip); owners.set(mutation.clipId, mutation.placement.trackId);
			} else { clips.delete(mutation.clipId); owners.delete(mutation.clipId); }
		} else if (value.type === 'video-visual-presentation/set') {
			const mutation = value as FramescaperVideoVisualPresentationSetCommandFinishing;
			if (mutation.presentation) presentations.set(mutation.presentationId, mutation.presentation);
			else presentations.delete(mutation.presentationId);
		}
	}

	function visit(value: FramescaperProjectCommandTimelineImage): FramescaperProjectCommandTimelineImage {
		if (value.type === 'batch') return { ...value, commands: (value as FramescaperProjectCommandBatchTimelineImage).commands.map(visit) };
		if (value.type !== 'edit/insert') { observe(value); return value; }
		const insert = value as Extract<AudioEditorCommand, { type: 'edit/insert' }>;
		const commands: FramescaperProjectCommandTimelineImage[] = [];
		for (const original of [...clips.values()]) {
			const trackId = owners.get(original.id);
			if (!trackId || !insert.trackIds.includes(trackId)) continue;
			const sequence = project.sequences.find(item => item.id === original.sequenceId);
			if (!sequence) throw new ReferenceError('Native picture insertion requires its sequence clock.');
			const start = sampleFrameToVideoFrame(insert.startFrame, sequence.rate, project.sampleRate, 'point');
			const end = sampleFrameToVideoFrame(insert.endFrame, sequence.rate, project.sampleRate, 'point');
			const count = end - start;
			if (count <= 0 || original.sequenceStartFrame + original.sequenceFrameCount <= start) continue;
			if (original.sequenceStartFrame >= start) {
				append(mutation(original, { ...original, sequenceStartFrame: original.sequenceStartFrame + count }, trackId));
				continue;
			}
			const rightClipId = insert.splitClipIds?.[original.id];
			if (!rightClipId) throw new TypeError(`Native picture insertion requires a stable split ID for ${original.id}.`);
			if (original.kind === 'still') {
				append(mutation(original, { ...original, sequenceFrameCount: start - original.sequenceStartFrame }, trackId));
				append(mutation(null, { ...original, id: rightClipId, sequenceStartFrame: start,
					sequenceFrameCount: original.sequenceStartFrame + original.sequenceFrameCount - start }, trackId));
				for (const copied of createSplitVisualPresentationPlanner([...presentations.values()]).copy(original.id, rightClipId)) append(copied);
			} else {
				// Reuse the existing source-phase and authored-presentation split rules.
				const staged = { ...project, clips: [...clips.values()], videoVisualPresentations: [...presentations.values()],
					tracks: project.tracks.map(track => ({ ...track, clipIds: [...owners].filter(([, owner]) => owner === track.id).map(([id]) => id) }))
				} as unknown as FramescaperProjectTimelineImage;
				const split: AudioEditorCommand = { type: 'clip/split', clipId: original.id,
					atFrame: insert.startFrame, rightClipId };
				append(prepareTimelineGeneratorSplitCommand(staged, prepareTimelineImageSplitCommand(staged, split)));
			}
			const right = clips.get(rightClipId)!;
			append(mutation(right, { ...right, sequenceStartFrame: end }, trackId));
		}
		return commands.length ? { type: 'batch', commands: [...commands, value] } : value;

		function append(child: FramescaperProjectCommandTimelineImage): void { commands.push(child); observe(child); }
	}
}

function mutation(expectedClip: NativeClip | null, clip: NativeClip, trackId: string): FramescaperProjectCommandTimelineImage {
	const placement = { scope: 'timeline' as const, trackId };
	return clip.kind === 'image' ? { type: 'image-clip/set', clipId: clip.id,
		expectedClip: expectedClip as FramescaperImageClipV1 | null,
		expectedPlacement: expectedClip ? placement : null, clip, placement }
		: { type: 'video-visual-clip/set', clipId: clip.id,
			expectedClip: expectedClip as VideoGeneratorClipV1 | VideoStillClipV1 | null,
			expectedPlacement: expectedClip ? placement : null, clip, placement };
}
