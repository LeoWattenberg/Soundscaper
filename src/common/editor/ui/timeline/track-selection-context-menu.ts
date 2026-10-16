/* SPDX-License-Identifier: AGPL-3.0-only */

import { trackSourceChannelCount } from '../application-menu-model.js';
import { isStandaloneMonoAudioTrack } from '../../mono-track-pair-admission.ts';

export interface TrackSelectionContextTrack {
	readonly id: string;
	readonly type?: string;
	readonly clipIds?: readonly string[];
	readonly locked?: boolean;
	readonly laneGroupId?: string | null;
}

interface TrackSelectionContextProject {
	readonly tracks: readonly TrackSelectionContextTrack[];
	readonly clips: readonly Readonly<{ id: string; sourceId?: string }>[];
	readonly sources?: readonly Readonly<{ id: string; channelCount?: number }>[];
}

export interface TrackSelectionContextActions {
	readonly update?: (id: string, changes: Readonly<{ locked?: boolean; color?: string; halfWave?: boolean; showRms?: boolean }>) => unknown;
	readonly makeStereo?: (id: string) => unknown;
	readonly swapChannels?: (id: string) => unknown;
	readonly splitStereoLR?: (id: string) => unknown;
	readonly splitStereoCenter?: (id: string) => unknown;
}

interface ContextMenuItem {
	readonly id: string;
	readonly label: string;
	readonly disabled: boolean;
	readonly onClick?: () => unknown;
	readonly items?: readonly ContextMenuItem[];
}

/** Structural commands affect every member of the existing linked media block. */
export function trackStructureMutationBlocked(
	project: Pick<TrackSelectionContextProject, 'tracks'> | null,
	track: TrackSelectionContextTrack | null,
): boolean {
	return track?.locked === true || Boolean(track?.laneGroupId
		&& project?.tracks.some(candidate => candidate.laneGroupId === track.laneGroupId && candidate.locked === true));
}

/** Shared lock/channel commands for track overflow and selected-track shortcuts. */
export function createTrackSelectionContextMenuItems(input: Readonly<{
	project: TrackSelectionContextProject | null;
	track: TrackSelectionContextTrack | null;
	copy: Readonly<Record<string, string>>;
	audioEffects: boolean;
	blocked: boolean;
	actions?: TrackSelectionContextActions;
}>) {
	const { project, track, copy, blocked, audioEffects, actions = {} } = input;
	const audioTrack = track?.type === 'audio' ? track : null;
	const channelCount = trackSourceChannelCount(project, audioTrack) as number;
	const sourceBlocked = blocked || audioTrack?.locked === true;
	const structureBlocked = blocked || trackStructureMutationBlocked(project, audioTrack);
	const primaryIndex = project?.tracks.findIndex(candidate => candidate.id === audioTrack?.id) ?? -1;
	const partners = project?.tracks.filter(candidate => candidate.id !== audioTrack?.id
		&& isStandaloneMonoAudioTrack(candidate, trackSourceChannelCount(project, candidate) as number)) ?? [];
	const partner = partners.find(candidate => (project?.tracks.indexOf(candidate) ?? -1) > primaryIndex) ?? partners[0];
	const compatibleMonoTrack = isStandaloneMonoAudioTrack(audioTrack, channelCount) && partner && !partner.locked;
	const channelItem = (id: string, label: string, unavailable: boolean, operation?: (id: string) => unknown): ContextMenuItem => ({
		id, label, disabled: sourceBlocked || !audioTrack || unavailable || !operation,
		onClick: () => !sourceBlocked && !unavailable && audioTrack ? operation?.(audioTrack.id) : undefined,
	});
	return {
		shared: [{
			id: 'track-lock-toggle', label: track?.locked ? copy.unlockTrack : copy.lockTrack,
			disabled: blocked || !track || !actions.update,
			onClick: () => track ? actions.update?.(track.id, { locked: !track.locked }) : undefined,
		}],
		audio: audioEffects ? [{
			id: 'track-channels', label: copy.trackChannels, disabled: sourceBlocked || !audioTrack,
			items: [
				channelItem('track-make-stereo', copy.makeStereoTrack, !compatibleMonoTrack, actions.makeStereo),
				channelItem('track-swap-channels', copy.swapStereoChannels, channelCount !== 2, actions.swapChannels),
				channelItem('track-split-stereo-to-lr', copy.splitStereoLr, structureBlocked || channelCount !== 2, actions.splitStereoLR),
				channelItem('track-split-stereo-to-center', copy.splitStereoCenter, structureBlocked || channelCount !== 2, actions.splitStereoCenter),
			],
		}] : [],
	};
}
