/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../commands/protocol.ts';
import type { ControllerProject } from '../controller/track-domain-types.ts';

interface AudacityTrackMixerSnapshot {
	readonly project?: ControllerProject | null;
	readonly selectedTrackId?: string | null;
}

type Commit = (command: AudioEditorCommand) => unknown;

const ACTION_IDS = Object.freeze([
	'mute-tracks', 'unmute-tracks', 'track-pan-left', 'track-pan-right',
	'track-gain-inc', 'track-gain-dec', 'track-mute', 'track-solo',
]);

/** Execute one uncommon legacy mixer command outside the startup graph. */
export function applyAudacityTrackMixerAction(
	actionId: string,
	snapshot: AudacityTrackMixerSnapshot,
	commit: Commit,
): unknown {
	const action = ACTION_IDS.indexOf(actionId);
	if (action < 0) return null;
	const project = snapshot.project;
	if (!project) return null;
	if (action < 2) return setSelectedMuted(project, snapshot.selectedTrackId, action === 0, commit);
	const track = project.tracks.find((candidate) => candidate.id === snapshot.selectedTrackId);
	if (!track || track.type === 'label') return null;
	if (action >= 6) {
		const key = action === 6 ? 'mute' : 'solo';
		return commit({ type: 'track/update', trackId: track.id, changes: { [key]: !track[key] } });
	}
	if (track.type !== 'audio') return null;
	const gain = action >= 4;
	const minimum = gain ? -60 : -1;
	const maximum = gain ? 12 : 1;
	const linear = Number(track.gain ?? 1);
	const raw = gain
		? Number.isFinite(linear) && linear > 0 ? 20 * Math.log10(linear) : -Infinity
		: Number(track.pan);
	const current = Math.max(minimum, Math.min(maximum, gain || Number.isFinite(raw) ? raw : 0));
	const delta = action === 2 || action === 5 ? -1 : 1;
	const next = Math.max(minimum, Math.min(maximum, current + delta * (gain ? 1 : 0.1)));
	if (next === current) return null;
	const key = gain ? 'gain' : 'pan';
	return commit({
		type: 'track/update', trackId: track.id,
		changes: { [key]: gain ? 10 ** (next / 20) : next },
	});
}

function setSelectedMuted(
	project: ControllerProject,
	focusedTrackId: string | null | undefined,
	mute: boolean,
	commit: Commit,
): unknown {
	const selectionTrackIds = project.selection?.trackIds || [];
	const selected = new Set(selectionTrackIds.length
		? selectionTrackIds
		: focusedTrackId ? [focusedTrackId] : []);
	const tracks = project.tracks.filter((track) => (
		track.type !== 'label' && selected.has(track.id) && track.mute !== mute
	));
	if (!tracks.length) return null;
	return commit({
		type: 'batch',
		commands: tracks.map((track) => ({
			type: 'track/update', trackId: track.id, changes: { mute },
		})),
	});
}
