/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { normalizeFramescaperImageClipV1 } from '../common/editor/timeline-image-model.ts';
import { prepareTimelineImageTrim } from '../common/editor/timeline-image-trim.ts';
import type { FramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';
import type { FramescaperProjectCommandTimelineImage } from './editor-project-timeline-image-commands.ts';
import type { FramescaperImageClipSetCommandTimelineImage } from './editor-project-timeline-image-image-command.ts';

/** Preserve exact image leaves when the ordinary edge handles emit an inherited trim. */
export function prepareTimelineImageTrimCommand(project: FramescaperProjectTimelineImage,
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
				clips.set(mutation.clipId, mutation.clip); owners.set(mutation.clipId, mutation.placement.trackId);
			} else { clips.delete(mutation.clipId); owners.delete(mutation.clipId); }
			return value;
		}
		if (value.type !== 'clip/trim') return value;
		const trim = value as Extract<AudioEditorCommand, { type: 'clip/trim' }>;
		const expectedClip = clips.get(trim.clipId);
		if (!expectedClip) return value;
		const source = project.sources.find(item => item.id === expectedClip.sourceId);
		if (source?.kind !== 'image') throw new ReferenceError('An image trim requires its exact source.');
		const clip = prepareTimelineImageTrim(project, expectedClip, source, trim);
		const trackId = owners.get(clip.id);
		if (!trackId) throw new ReferenceError('An image trim requires its picture track.');
		const placement = { scope: 'timeline' as const, trackId };
		clips.set(clip.id, clip);
		return { type: 'image-clip/set', clipId: clip.id, expectedClip, expectedPlacement: placement, clip, placement };
	}
}
