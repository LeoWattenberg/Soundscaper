/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand, CommandObject } from '../commands/protocol.ts';

interface DuplicableEffect extends Readonly<Record<string, unknown>> {
	readonly id: string;
}

export interface DuplicableTrack extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly name: string;
	readonly type: string;
	readonly clipIds: readonly string[];
	readonly effects?: readonly DuplicableEffect[];
}

export interface DuplicableClip extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly kind?: string;
	readonly videoEffects?: readonly Readonly<Record<string, unknown>>[];
}

export interface TrackDuplicationProject extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly tracks: readonly DuplicableTrack[];
	readonly clips: readonly DuplicableClip[];
}

interface TrackDuplicationSelection {
	readonly selectTrackId: string;
	readonly selectClipId: string | null;
}

export interface TrackDuplicationServiceDependencies {
	readonly lifetime: Readonly<{ assertActive(): void }>;
	readonly copySuffix: string;
	readonly editingBlocked: () => boolean;
	readonly getProject: () => TrackDuplicationProject;
	readonly createId: (prefix: string) => string;
	readonly findClip: (project: TrackDuplicationProject, clipId: string) => DuplicableClip | null;
	readonly cloneVideoEffects: (
		effects: readonly Readonly<Record<string, unknown>>[],
		options: Readonly<{ regenerateIds: true }>,
	) => readonly Readonly<Record<string, unknown>>[];
	readonly createAddTrackCommand: (track: CommandObject) => Extract<AudioEditorCommand, { type: 'track/add' }>;
	readonly createAddClipCommand: (
		trackId: string,
		clip: CommandObject,
	) => Extract<AudioEditorCommand, { type: 'clip/add' }>;
	readonly commit: (command: AudioEditorCommand, selection: TrackDuplicationSelection) => unknown;
}

export function createTrackDuplicationService(dependencies: TrackDuplicationServiceDependencies) {
	return Object.freeze({ duplicateTrack });

	function duplicateTrack(track: DuplicableTrack | null | undefined): void {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked() || !track) return;
		const project = dependencies.getProject();
		const trackId = dependencies.createId('track');
		const effects = (track.effects || []).map((effect) => ({
			...structuredClone(effect),
			id: dependencies.createId('effect'),
		}));
		const commands: AudioEditorCommand[] = [dependencies.createAddTrackCommand({
			...track,
			id: trackId,
			name: `${track.name} ${dependencies.copySuffix}`,
			armed: false,
			effects,
			clipIds: [],
			laneGroupId: null,
		})];
		let selectedClipId: string | null = null;
		for (const clipId of track.clipIds) {
			const clip = dependencies.findClip(project, clipId);
			if (!clip) continue;
			const nextClipId = dependencies.createId('clip');
			selectedClipId ||= nextClipId;
			commands.push(dependencies.createAddClipCommand(trackId, {
				...clip,
				id: nextClipId,
				avLinkId: null,
				...(clip.kind === 'video' ? {
					videoEffects: dependencies.cloneVideoEffects(clip.videoEffects || [], {
						regenerateIds: true,
					}),
				} : {}),
			}));
		}
		dependencies.commit(
			{ type: 'batch', commands },
			{ selectTrackId: trackId, selectClipId: selectedClipId },
		);
	}
}
