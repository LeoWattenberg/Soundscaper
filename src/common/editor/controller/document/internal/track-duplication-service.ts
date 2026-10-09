/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand, CommandObject } from '../../../commands/protocol.ts';
import { preserveProductionTrackRouting } from '../../../derived-track-routing.ts';
import { trackHierarchyPlacement } from '../../../track-hierarchy-placement.ts';
import type {
	ControllerTrackDuplicateCarrier,
	ControllerTrackDuplicateRequest,
} from '../project-runtime.ts';

interface DuplicableEffect extends Readonly<Record<string, unknown>> {
	readonly id: string;
}

export interface DuplicableTrack extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly name: string;
	readonly type: string;
	readonly clipIds?: readonly string[];
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
	readonly supportsTrackFolders?: boolean;
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
	readonly prepareTrackDuplicateCarrier?: (
		project: TrackDuplicationProject,
		request: Readonly<ControllerTrackDuplicateRequest>,
	) => Readonly<ControllerTrackDuplicateCarrier>;
	readonly previewCommand?: (project: TrackDuplicationProject, command: AudioEditorCommand) => Readonly<Record<string, unknown>>;
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
		const addTrack = dependencies.createAddTrackCommand({
			...track,
			id: trackId,
			name: `${track.name} ${dependencies.copySuffix}`,
			armed: false,
			locked: false,
			effects,
			clipIds: [],
			laneGroupId: null,
		});
		const duplicateRequest = Object.freeze({
			sourceTrackId: track.id,
			targetTrackId: trackId,
			effectIds: Object.freeze((track.effects || []).map((effect, index) => Object.freeze({
				sourceId: effect.id,
				targetId: effects[index]!.id,
			}))),
		});
		const productionDuplicate = dependencies.prepareTrackDuplicateCarrier
			? dependencies.prepareTrackDuplicateCarrier(project, duplicateRequest)
			: legacyDuplicateCarrier(duplicateRequest);
		const placement = trackHierarchyPlacement(project, track.id, 1, dependencies.supportsTrackFolders);
		const commands: AudioEditorCommand[] = [{
			...addTrack,
			...placement,
			productionDuplicate,
		}];
		let selectedClipId: string | null = null;
		const groupIds = new Map<string, string>();
		for (const clipId of track.clipIds ?? []) {
			const clip = dependencies.findClip(project, clipId);
			if (!clip) continue;
			const nextClipId = dependencies.createId('clip');
			selectedClipId ||= nextClipId;
			let groupId: string | null = null;
			if (typeof clip.groupId === 'string' && clip.groupId) {
				groupId = groupIds.get(clip.groupId) ?? dependencies.createId('clip-group');
				groupIds.set(clip.groupId, groupId);
			}
			commands.push(dependencies.createAddClipCommand(trackId, {
				...clip,
				id: nextClipId,
				avLinkId: null,
				groupId,
				...(clip.kind === 'video' ? {
					videoEffects: dependencies.cloneVideoEffects(clip.videoEffects || [], {
						regenerateIds: true,
					}),
				} : {}),
			}));
		}
		const routed = preserveProductionTrackRouting(project, { type: 'batch', commands }, [
			{ sourceTrackId: track.id, targetTrackId: trackId },
		], dependencies.previewCommand, dependencies.createId);
		dependencies.commit(
			track.locked === true ? { type: 'batch', commands: [routed, {
				type: 'track/update', trackId, changes: { locked: true },
			}] } : routed,
			{ selectTrackId: trackId, selectClipId: selectedClipId },
		);
	}
}

function legacyDuplicateCarrier(
	request: Readonly<ControllerTrackDuplicateRequest>,
): Readonly<ControllerTrackDuplicateCarrier> {
	return Object.freeze({
		sourceTrackId: request.sourceTrackId,
		effectIds: request.effectIds,
	});
}
