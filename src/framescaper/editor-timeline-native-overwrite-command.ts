/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { normalizeFramescaperImageClipV1, type FramescaperImageClipV1 } from '../common/editor/timeline-image-model.ts';
import { prepareTimelineImageTrim } from '../common/editor/timeline-image-trim.ts';
import { prepareTimelineGeneratorTrim } from '../common/editor/timeline-generator-trim.ts';
import { sampleFrameToVideoFrame, videoFrameToSampleFrame } from '../common/editor/timeline-time.ts';
import { normalizeVideoGeneratorClipV1, normalizeVideoStillClipV1,
	type VideoGeneratorClipV1, type VideoStillClipV1 } from '../common/editor/video-visual-model-v24.ts';
import type { VideoVisualPresentationV1 } from '../common/editor/video-visual-presentation-v27.ts';
import type { FramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';
import type { FramescaperProjectCommandTimelineImage, FramescaperProjectCommandBatchTimelineImage } from './editor-project-timeline-image-commands.ts';
import type { FramescaperImageClipSetCommandTimelineImage } from './editor-project-timeline-image-image-command.ts';
import type { FramescaperVideoVisualClipSetCommandVisual } from './editor-project-visual-visual-command.ts';
import type { FramescaperVideoVisualPresentationSetCommandFinishing } from './editor-project-finishing-finishing-command.ts';
import { createSplitVisualPresentationPlanner } from './editor-split-visual-presentations.ts';

type NativeClip = FramescaperImageClipV1 | VideoGeneratorClipV1 | VideoStillClipV1;

/** Bin Overwrite lifts native picture only on the lanes receiving the incoming edit. */
export function prepareTimelineNativeOverwriteCommand(project: FramescaperProjectTimelineImage,
	command: FramescaperProjectCommandTimelineImage): FramescaperProjectCommandTimelineImage {
	const clips = new Map<string, NativeClip>();
	for (const value of project.clips as readonly Readonly<Record<string, unknown>>[]) {
		if (value.kind === 'image') clips.set(String(value.id), normalizeFramescaperImageClipV1(value));
		else if (value.kind === 'generator') clips.set(String(value.id), normalizeVideoGeneratorClipV1(value));
		else if (value.kind === 'still') clips.set(String(value.id), normalizeVideoStillClipV1(value));
	}
	const owners = new Map(project.tracks.flatMap(track => (Array.isArray(track.clipIds)
		? track.clipIds as readonly string[] : []).map(id => [id, track.id] as const)));
	const sources = new Map((project.sources as readonly Readonly<Record<string, unknown>>[]).map(source => [String(source.id), source]));
	const presentations = new Map((project.videoVisualPresentations as readonly VideoVisualPresentationV1[]).map(row => [row.id, row]));
	const presentationCopies = createSplitVisualPresentationPlanner([...presentations.values()]);
	let selection = project.selection;
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
			presentationCopies.observe(mutation);
		} else if (value.type === 'selection/set') {
			selection = { ...selection, ...value as Extract<AudioEditorCommand, { type: 'selection/set' }> };
		} else if (value.type === 'image-source/set' || value.type === 'video-visual-source/set') {
			const mutation = value as unknown as Readonly<{ sourceId: string; source: Readonly<Record<string, unknown>> | null }>;
			if (mutation.source) sources.set(mutation.sourceId, mutation.source);
			else sources.delete(mutation.sourceId);
		}
	}

	function visit(value: FramescaperProjectCommandTimelineImage): FramescaperProjectCommandTimelineImage {
		if (value.type === 'batch') return { ...value, commands: (value as FramescaperProjectCommandBatchTimelineImage).commands.map(visit) };
		if (value.type !== 'edit/overwrite') { observe(value); return value; }
		const overwrite = value as Extract<AudioEditorCommand, { type: 'edit/overwrite' }>;
		const commands: FramescaperProjectCommandTimelineImage[] = [];
		for (const original of [...clips.values()]) {
			const trackId = owners.get(original.id);
			if (!trackId || !overwrite.trackIds.includes(trackId)) continue;
			const sequence = project.sequences.find(item => item.id === original.sequenceId);
			if (!sequence) throw new ReferenceError('Native picture overwrite requires its sequence clock.');
			const start = sampleFrameToVideoFrame(overwrite.startFrame, sequence.rate, project.sampleRate, 'point');
			const end = sampleFrameToVideoFrame(overwrite.endFrame, sequence.rate, project.sampleRate, 'point');
			const clipEnd = original.sequenceStartFrame + original.sequenceFrameCount;
			if (end <= start || end <= original.sequenceStartFrame || start >= clipEnd) continue;
			const left = original.sequenceStartFrame < start ? segment(original, original.sequenceStartFrame, start) : null;
			const right = clipEnd > end ? segment(original, end, clipEnd) : null;
			if (!left && !right) {
				for (const row of [...presentations.values()]) if (row.owner.kind === 'clip' && row.owner.id === original.id) {
					append({ type: 'video-visual-presentation/set', presentationId: row.id, expectedPresentation: row, presentation: null });
				}
				append({ type: 'selection/set', startFrame: selection.startFrame, endFrame: selection.endFrame,
					trackIds: selection.trackIds, clipIds: selection.clipIds.filter(id => id !== original.id) });
			}
			append(mutation(original, left ?? right, trackId));
			if (left && right) {
				const id = overwrite.splitClipIds?.[original.id];
				if (!id) throw new TypeError(`Native picture overwrite requires a stable split ID for ${original.id}.`);
				append(mutation(null, { ...right, id }, trackId));
				for (const copied of presentationCopies.copy(original.id, id)) append(copied);
			}
		}
		return commands.length ? { type: 'batch', commands: [...commands, value] } : value;

		function append(child: FramescaperProjectCommandTimelineImage): void { commands.push(child); observe(child); }
	}

	function segment(original: NativeClip, start: number, end: number): NativeClip {
		if (original.kind === 'still') return normalizeVideoStillClipV1({ ...original, sequenceStartFrame: start, sequenceFrameCount: end - start });
		const sequence = project.sequences.find(item => item.id === original.sequenceId)!;
		const source = sources.get(original.sourceId);
		const startSample = videoFrameToSampleFrame(start, sequence.rate, project.sampleRate, 'point');
		const endSample = videoFrameToSampleFrame(end, sequence.rate, project.sampleRate, 'point');
		const changes = { timelineStartFrame: startSample, durationFrames: endSample - startSample };
		if (original.kind === 'generator') {
			if (source?.kind !== 'generator' || typeof source.frameCount !== 'number') throw new ReferenceError('Native overwrite requires its generator source.');
			return prepareTimelineGeneratorTrim(project, original, { frameCount: source.frameCount }, changes);
		}
		if (source?.kind !== 'image' || !source.canonical) throw new ReferenceError('Native overwrite requires its exact image source.');
		return prepareTimelineImageTrim(project, original, source as unknown as Readonly<{ canonical: Readonly<{ durationTicks: string }> }>, changes);
	}
}

function mutation(expectedClip: NativeClip | null, clip: NativeClip | null, trackId: string): FramescaperProjectCommandTimelineImage {
	const clipId = expectedClip?.id ?? clip?.id;
	if (!clipId) throw new TypeError('A native overwrite mutation requires a clip identity.');
	const placement = { scope: 'timeline' as const, trackId };
	return { type: (expectedClip ?? clip)?.kind === 'image' ? 'image-clip/set' : 'video-visual-clip/set',
		clipId, expectedClip, expectedPlacement: expectedClip ? placement : null, clip,
		placement: clip ? placement : null } as FramescaperImageClipSetCommandTimelineImage | FramescaperVideoVisualClipSetCommandVisual;
}
