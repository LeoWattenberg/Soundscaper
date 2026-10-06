/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAddTrackCommand } from '../../../../commands/factories.ts';
import type { AudioEditorCommand } from '../../../../commands/protocol.ts';
import type { ClipTransformClip, ClipTransformProject } from './clip-domain-types.ts';

/** Derive destinations for picture-bearing clip moves, including image-only rows. */
export function prepareMediaNewTrackPlan(project: ClipTransformProject, clips: readonly ClipTransformClip[],
	createId: (prefix: string) => string, trackName: string) {
	const movingTrackIds = new Set(project.tracks.filter(track => (
		track.clipIds?.some(id => clips.some(clip => clip.id === id))
	)).map(track => track.id));
	const destinationTrackIds = new Map<string, string>();
	const commands: AudioEditorCommand[] = [];
	for (const track of project.tracks) {
		if (!movingTrackIds.has(track.id) || destinationTrackIds.has(track.id)) continue;
		if (track.type === 'video') {
			const hasVideo = clips.some(clip => clip.kind === 'video' && track.clipIds?.includes(clip.id));
			const companion = hasVideo && track.laneGroupId ? project.tracks.find(candidate => (
				candidate.type === 'audio' && candidate.laneGroupId === track.laneGroupId
			)) : null;
			const laneGroupId = hasVideo ? createId('media-lane') : undefined;
			const videoTrackId = createId('video-track');
			commands.push(createAddTrackCommand({ type: 'video', id: videoTrackId, name: track.name,
				...(track.height === undefined ? {} : { height: track.height }),
				...(track.color === undefined ? {} : { color: track.color }), ...(laneGroupId ? { laneGroupId } : {}) }));
			destinationTrackIds.set(track.id, videoTrackId);
			if (hasVideo) {
				const audioTrackId = createId('track');
				commands.push(createAddTrackCommand({ type: 'audio', id: audioTrackId,
					name: companion?.name || `${track.name} Audio`, channelCount: companion?.channelCount || 2,
					color: companion?.color, armed: false, laneGroupId }));
				if (companion) destinationTrackIds.set(companion.id, audioTrackId);
			}
		} else if (track.type === 'audio') {
			const trackId = createId('track');
			commands.push(createAddTrackCommand({ type: 'audio', id: trackId,
				name: `${trackName} ${project.tracks.length + commands.length + 1}`,
				channelCount: track.channelCount, color: track.color, armed: false }));
			destinationTrackIds.set(track.id, trackId);
		}
	}
	return { commands, destinationTrackIds };
}
