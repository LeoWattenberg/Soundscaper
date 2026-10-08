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
	const compatibleMonoTrack = isStandaloneMonoAudioTrack(audioTrack, channelCount) && project?.tracks.some((candidate) => (
		candidate.id !== audioTrack?.id && isStandaloneMonoAudioTrack(candidate, trackSourceChannelCount(project, candidate) as number)
	));
	const channelItem = (id: string, label: string, unavailable: boolean, operation?: (id: string) => unknown): ContextMenuItem => ({
		id, label, disabled: blocked || !audioTrack || unavailable || !operation,
		onClick: () => audioTrack ? operation?.(audioTrack.id) : undefined,
	});
	return {
		shared: [{
			id: 'track-lock-toggle', label: track?.locked ? copy.unlockTrack : copy.lockTrack,
			disabled: blocked || !track || !actions.update,
			onClick: () => track ? actions.update?.(track.id, { locked: !track.locked }) : undefined,
		}],
		audio: audioEffects ? [{
			id: 'track-channels', label: copy.trackChannels, disabled: blocked || !audioTrack,
			items: [
				channelItem('track-make-stereo', copy.makeStereoTrack, !compatibleMonoTrack, actions.makeStereo),
				channelItem('track-swap-channels', copy.swapStereoChannels, channelCount !== 2, actions.swapChannels),
				channelItem('track-split-stereo-to-lr', copy.splitStereoLr, channelCount !== 2, actions.splitStereoLR),
				channelItem('track-split-stereo-to-center', copy.splitStereoCenter, channelCount !== 2, actions.splitStereoCenter),
			],
		}] : [],
	};
}
