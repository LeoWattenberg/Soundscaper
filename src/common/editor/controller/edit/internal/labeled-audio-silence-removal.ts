/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import { prepareDisjointRangeDeleteCommand } from '../../../commands/range-runtime.js';
import { brandRuntimeProjectProjection, isRuntimeProjectProjection } from '../../../runtime-clip-projection.ts';
import type { LabeledAudioRegion } from '../../../labeled-audio-regions.ts';
import type { AudioGeneratorProject } from './generator-project-view.ts';

/** A silence replacement owns the audio, leaving linked picture material intact. */
export function prepareLabeledAudioSilenceRemoval(
	project: AudioGeneratorProject,
	ranges: readonly LabeledAudioRegion[],
	trackIds: readonly string[],
	createId: (prefix?: string) => string,
): AudioEditorCommand {
	const scope = new Set(trackIds);
	const audioIds = new Set(project.tracks.filter(track => track.type === 'audio' && scope.has(track.id))
		.flatMap(track => track.clipIds ?? []));
	const links = new Set<string>();
	const affected = new Map<string, string>();
	for (const clip of project.clips) {
		if (!audioIds.has(clip.id) || typeof clip.avLinkId !== 'string' || !clip.avLinkId) continue;
		links.add(clip.avLinkId);
		if (ranges.some(range => range.startFrame < clip.timelineStartFrame + clip.durationFrames
			&& range.endFrame > clip.timelineStartFrame)) affected.set(clip.avLinkId, clip.id);
	}
	const prepared = links.size ? { ...project, clips: project.clips.map(clip =>
		typeof clip.avLinkId === 'string' && links.has(clip.avLinkId) ? { ...clip, avLinkId: null } : clip) } : project;
	// Both preparation and execution use the audio clock, including when a
	// different untouched pair shares its lane. Only intersected pairs are
	// detached in the durable edit; the planning view suppresses peer expansion.
	if (prepared !== project && isRuntimeProjectProjection(project)) brandRuntimeProjectProjection(prepared);
	const removal = prepareDisjointRangeDeleteCommand(prepared, {
		ranges, trackIds, rippleMode: 'none',
	}, createId) as AudioEditorCommand;
	const unlinks: AudioEditorCommand[] = [...affected.values()].map(clipId => ({ type: 'clip/unlink-av', clipId }));
	return unlinks.length ? { type: 'batch', commands: [...unlinks, removal] } : removal;
}
