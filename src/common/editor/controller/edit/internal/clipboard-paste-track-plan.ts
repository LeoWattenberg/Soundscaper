/* SPDX-License-Identifier: AGPL-3.0-only */

import { publishedCopyFor } from '../../shared/presentation-localization.ts';
import { createAddSourceCommand, createAddTrackCommand } from '../../../commands/factories.ts';
import { hasProjectBinMediaAuthority } from '../../../project-schema-version.ts';
import type { AudioEditorClipboardTrack, AudioEditorCommand } from '../../../commands/protocol.ts';
import { clipboardPasteTrackType, planClipboardPasteTargets } from '../../../clipboard-paste-targets.ts';
import { missingClipboardSourcesForPaste } from './clipboard-source-identity.ts';
import type { ClipboardEditProject, ClipboardEditMediaTrack, ClipboardEditTrack, ClipboardEditSource } from './clipboard-edit-service.ts';

/** Shared placement/source preparation carries no recipe-version authority. */
export function prepareClipboardPasteTrackPlan(project: ClipboardEditProject, selectedTrackId: string | null,
	clipboardTracks: readonly AudioEditorClipboardTrack[], sources: readonly ClipboardEditSource[], hasCarrier: boolean,
	createId: (prefix?: string) => string, copy: Readonly<{ track: string }>) {
	const trackMap = Object.create(null) as Record<string, string>;
	const commands: AudioEditorCommand[] = missingClipboardSourcesForPaste(project.sources, sources)
		.map((source) => hasCarrier && source.kind !== undefined && source.kind !== 'audio' && source.kind !== 'video'
			? { type: 'source/add', source: structuredClone(source) } as AudioEditorCommand
			: createAddSourceCommand(source));
	let addedTrackCount = 0;
	const selected = findMediaTrack(project, selectedTrackId);
	/**
	 * A synthesized paste track joins the folder of the track the paste is
	 * anchored to: the selected track's parent, else the surviving source
	 * track's parent, else the sequence root.
	 */
	const resolveFolderPlacement = (
		clipboardTrack: AudioEditorClipboardTrack,
	): Readonly<{ sequenceId: string; parentFolderId: string | null }> | null => {
		if (!project.trackFolders?.length || !project.sequences?.length) return null;
		for (const anchorId of [selected?.id, clipboardTrack.sourceTrackId]) {
			if (!anchorId) continue;
			for (const sequence of project.sequences) {
				const node = sequence.trackNodes.find((candidate) => candidate.id === anchorId);
				if (node) return { sequenceId: sequence.id, parentFolderId: node.parentFolderId };
			}
		}
		const fallback = project.sequences.find(({ id }) => id === project.primarySequenceId)
			?? project.sequences[0];
		return { sequenceId: fallback.id, parentFolderId: null };
	};
	const createTargetTrack = (
		clipboardTrack: AudioEditorClipboardTrack,
		laneGroupId: string | null = null,
	): ClipboardEditMediaTrack => {
		const type = clipboardPasteTrackType(clipboardTrack);
		if (type === 'video' && !hasProjectBinMediaAuthority(project)) {
			throw new RangeError('Video clipboard tracks require an AudioEditorProjectV4 project.');
		}
		const trackId = createId(type === 'video' ? 'video-track' : 'track');
		addedTrackCount += 1;
		const placement = resolveFolderPlacement(clipboardTrack);
		commands.push({
			...createAddTrackCommand({
				type,
				id: trackId,
				name: clipboardTrack.sourceTrackName
					|| `${publishedCopyFor(copy).track} ${project.tracks.length + addedTrackCount}`,
				laneGroupId,
			}),
			...(placement === null ? {} : placement),
		});
		return { id: trackId, type, name: clipboardTrack.sourceTrackName, laneGroupId, clipIds: [] };
	};

	for (const group of planClipboardPasteTargets(project.tracks, selected?.id ?? null, clipboardTracks)) {
		const laneGroupId = group.length === 2 && !group[0]?.target ? createId('media-lanes') : null;
		for (const { clipboardTrack, target } of group) {
			trackMap[clipboardTrack.sourceTrackId] = (target ?? createTargetTrack(clipboardTrack, laneGroupId)).id;
		}
	}
	return { commands, trackMap };
}

export function isClipboardMediaTrack(track: ClipboardEditTrack): track is ClipboardEditMediaTrack {
	return (track.type === 'audio' || track.type === 'video') && Array.isArray(track.clipIds);
}

function findMediaTrack(
	project: ClipboardEditProject,
	trackId: string | null | undefined,
): ClipboardEditMediaTrack | null {
	const track = project.tracks.find((candidate) => candidate.id === trackId);
	return track && isClipboardMediaTrack(track) ? track : null;
}
