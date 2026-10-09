/* SPDX-License-Identifier: AGPL-3.0-only */

import { publishedCopyFor } from '../../shared/presentation-localization.ts';
import { createAddSourceCommand, createAddTrackCommand } from '../../../commands/factories.ts';
import { hasProjectBinMediaAuthority } from '../../../project-schema-version.ts';
import type { AudioEditorClipboardTrack, AudioEditorCommand } from '../../../commands/protocol.ts';
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
	const usedTrackIds = new Set<string>();
	const selected = findMediaTrack(project, selectedTrackId);
	const laneGroups = groupClipboardLanes(clipboardTracks);

	const targetMatches = (
		target: ClipboardEditMediaTrack | null,
		clipboardTrack: AudioEditorClipboardTrack,
	): target is ClipboardEditMediaTrack => Boolean(
		target
		&& target.type === clipboardTrackType(clipboardTrack)
		&& !usedTrackIds.has(target.id)
	);
	const assignTarget = (clipboardTrack: AudioEditorClipboardTrack, target: ClipboardEditMediaTrack) => {
		trackMap[clipboardTrack.sourceTrackId] = target.id;
		usedTrackIds.add(target.id);
	};
	const findTargetLanePair = (
		candidate: ClipboardEditMediaTrack | null,
	): readonly [ClipboardEditMediaTrack, ClipboardEditMediaTrack] | null => {
		if (!candidate?.laneGroupId) return null;
		const grouped = project.tracks
			.filter(isClipboardMediaTrack)
			.filter((track) => track.laneGroupId === candidate.laneGroupId);
		if (
			grouped.length !== 2
			|| grouped[0]?.type !== 'video'
			|| grouped[1]?.type !== 'audio'
			|| grouped.some((track) => usedTrackIds.has(track.id))
		) return null;
		return [grouped[0], grouped[1]];
	};
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
		const type = clipboardTrackType(clipboardTrack);
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

	for (const clipboardTrack of clipboardTracks) {
		if (trackMap[clipboardTrack.sourceTrackId]) continue;
		const grouped = clipboardTrack.sourceLaneGroupId
			? laneGroups.get(clipboardTrack.sourceLaneGroupId)
			: null;
		const videoClipboardTrack = grouped?.find((track) => clipboardTrackType(track) === 'video');
		const audioClipboardTrack = grouped?.find((track) => clipboardTrackType(track) === 'audio');
		if (grouped?.length === 2 && videoClipboardTrack && audioClipboardTrack) {
			const existingVideo = findMediaTrack(project, videoClipboardTrack.sourceTrackId);
			const existingAudio = findMediaTrack(project, audioClipboardTrack.sourceTrackId);
			let targetPair = findTargetLanePair(selected);
			if (!targetPair && (
				targetMatches(existingVideo, videoClipboardTrack)
				&& targetMatches(existingAudio, audioClipboardTrack)
				&& existingVideo.laneGroupId
				&& existingVideo.laneGroupId === existingAudio.laneGroupId
			)) targetPair = [existingVideo, existingAudio];
			if (!targetPair) {
				const laneGroupId = createId('media-lanes');
				targetPair = [
					createTargetTrack(videoClipboardTrack, laneGroupId),
					createTargetTrack(audioClipboardTrack, laneGroupId),
				];
			}
			assignTarget(videoClipboardTrack, targetPair[0]);
			assignTarget(audioClipboardTrack, targetPair[1]);
			continue;
		}

		const anchorIndex = selected ? project.tracks.indexOf(selected) : -1;
		let target = anchorIndex < 0 ? null : project.tracks.slice(anchorIndex)
			.filter(isClipboardMediaTrack).find((track) => targetMatches(track, clipboardTrack)) ?? null;
		if (!target) target = findMediaTrack(project, clipboardTrack.sourceTrackId);
		if (!targetMatches(target, clipboardTrack)) target = null;
		if (!target) target = createTargetTrack(clipboardTrack);
		assignTarget(clipboardTrack, target);
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

function clipboardTrackType(track: AudioEditorClipboardTrack): 'audio' | 'video' {
	if (track.sourceTrackType === 'video') return 'video';
	if (track.sourceTrackType === 'audio') return 'audio';
	return track.clips[0]?.kind === 'video' ? 'video' : 'audio';
}

function groupClipboardLanes(
	tracks: readonly AudioEditorClipboardTrack[],
): ReadonlyMap<string, readonly AudioEditorClipboardTrack[]> {
	const laneGroups = new Map<string, AudioEditorClipboardTrack[]>();
	for (const track of tracks) {
		if (!track.sourceLaneGroupId) continue;
		const grouped = laneGroups.get(track.sourceLaneGroupId) ?? [];
		grouped.push(track);
		laneGroups.set(track.sourceLaneGroupId, grouped);
	}
	return laneGroups;
}
