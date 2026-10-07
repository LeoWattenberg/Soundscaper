/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { normalizeVideoGeneratorClipV1, type VideoGeneratorClipV1 } from '../common/editor/video-visual-model-v24.ts';
import { prepareTimelineGeneratorTrim } from '../common/editor/timeline-generator-trim.ts';
import type { FramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';
import type { FramescaperProjectCommandTimelineImage, FramescaperProjectCommandBatchTimelineImage } from './editor-project-timeline-image-commands.ts';
import type { FramescaperVideoVisualClipSetCommandVisual } from './editor-project-visual-visual-command.ts';

/** Translate the enabled generator edge trim before inherited video allocation. */
export function prepareTimelineGeneratorTrimCommand(project: FramescaperProjectTimelineImage,
	command: FramescaperProjectCommandTimelineImage): FramescaperProjectCommandTimelineImage {
	const clips = new Map<string, VideoGeneratorClipV1>();
	for (const clip of project.clips as readonly Readonly<Record<string, unknown>>[]) {
		if (clip.kind === 'generator') clips.set(String(clip.id), normalizeVideoGeneratorClipV1(clip));
	}
	const owners = new Map(project.tracks.flatMap(track => (Array.isArray(track.clipIds)
		? track.clipIds as readonly string[] : []).map(id => [id, track.id] as const)));
	return visit(command);

	function visit(value: FramescaperProjectCommandTimelineImage): FramescaperProjectCommandTimelineImage {
		if (value.type === 'batch') return { ...value, commands: (value as FramescaperProjectCommandBatchTimelineImage).commands.map(visit) };
		if (value.type === 'video-visual-clip/set') {
			const mutation = value as FramescaperVideoVisualClipSetCommandVisual;
			if (mutation.clip?.kind === 'generator' && mutation.placement?.scope === 'timeline') {
				clips.set(mutation.clipId, mutation.clip); owners.set(mutation.clipId, mutation.placement.trackId);
			} else { clips.delete(mutation.clipId); owners.delete(mutation.clipId); }
			return value;
		}
		if (value.type !== 'clip/trim') return value;
		const trim = value as Extract<AudioEditorCommand, { type: 'clip/trim' }>;
		const expectedClip = clips.get(trim.clipId);
		if (!expectedClip) return value;
		const source = project.sources.find(item => item.id === expectedClip.sourceId) as Readonly<Record<string, unknown>> | undefined;
		if (source?.kind !== 'generator' || typeof source.frameCount !== 'number') throw new ReferenceError('A generator trim requires its native source.');
		const clip = prepareTimelineGeneratorTrim(project, expectedClip, { frameCount: source.frameCount }, trim);
		const trackId = owners.get(clip.id);
		if (!trackId) throw new ReferenceError('A generator trim requires its picture track.');
		const placement = { scope: 'timeline' as const, trackId };
		clips.set(clip.id, clip);
		return { type: 'video-visual-clip/set', clipId: clip.id, expectedClip, expectedPlacement: placement, clip, placement };
	}
}
