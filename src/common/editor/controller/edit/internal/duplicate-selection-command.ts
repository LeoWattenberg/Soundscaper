/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAddTrackCommand } from '../../../commands/factories.ts';
import { preparePasteCommand } from '../../../commands/clipboard-runtime.js';
import type { AudioEditorClipboard, AudioEditorCommand } from '../../../commands/protocol.ts';
import type { ControllerTrackDuplicateCarrier, ControllerTrackDuplicateRequest } from '../../document/project-runtime.ts';

interface DuplicateEffect extends Readonly<Record<string, unknown>> {
	readonly id: string;
}

interface DuplicateLabel extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly startFrame?: number;
	readonly endFrame?: number;
}

interface DuplicateTrack extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly name: string;
	readonly type: string;
	readonly effects?: readonly DuplicateEffect[];
	readonly labels?: readonly DuplicateLabel[];
	readonly laneGroupId?: string | null;
}

interface DuplicateProject extends Readonly<Record<string, unknown>> {
	readonly tracks: readonly DuplicateTrack[];
	readonly trackFolders?: readonly object[];
	readonly sequences?: readonly Readonly<{
		readonly id: string;
		readonly trackIds?: readonly string[];
		readonly trackNodes?: readonly Readonly<{ readonly id: string; readonly parentFolderId?: string | null }>[];
	}>[];
}

export interface DuplicateSelectionRange {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds: readonly string[];
	readonly clipIds?: readonly string[];
	readonly exactClips: boolean;
	readonly frequencyRange?: Extract<AudioEditorCommand, { type: 'selection/set' }>['frequencyRange'];
}

export interface DuplicateSelectionRuntime {
	readonly getProject: () => DuplicateProject;
	readonly createStableId: (prefix?: string) => string;
	readonly createClipboardDescriptor: (
		project: DuplicateProject,
		options: Readonly<{ startFrame: number; endFrame: number; trackIds: readonly string[]; clipIds?: readonly string[] }>,
	) => AudioEditorClipboard;
	readonly prepareTrackDuplicateCarrier?: (
		project: DuplicateProject,
		request: Readonly<ControllerTrackDuplicateRequest>,
	) => Readonly<ControllerTrackDuplicateCarrier>;
}

export interface DuplicateSelectionPlan {
	readonly command: AudioEditorCommand;
	readonly selectTrackId: string;
	readonly selectClipId: string | null;
}

/** Audacity Duplicate appends one track per source, retaining timing and the existing clipboard. */
export function prepareDuplicateSelectionCommand(
	runtime: DuplicateSelectionRuntime,
	range: DuplicateSelectionRange,
): DuplicateSelectionPlan | null {
	const project = runtime.getProject();
	const clipboard = runtime.createClipboardDescriptor(project, {
		startFrame: range.startFrame,
		endFrame: range.endFrame,
		trackIds: range.trackIds.filter((id) => project.tracks.find((track) => track.id === id)?.type !== 'label'),
		...(range.exactClips ? { clipIds: range.clipIds } : {}),
	});
	const requested = new Set([...range.trackIds, ...clipboard.tracks.map((track) => track.sourceTrackId)]);
	const sourceTracks = project.tracks.filter((track) => requested.has(track.id));
	if (!sourceTracks.length) return null;
	const commands: AudioEditorCommand[] = [];
	const trackMap: Record<string, string> = {};
	const laneGroups = new Map<string, string>();
	for (const track of sourceTracks) {
		const trackId = runtime.createStableId('track');
		trackMap[track.id] = trackId;
		const effects = (track.effects ?? []).map((effect) => ({ ...structuredClone(effect), id: runtime.createStableId('effect') }));
		const request = {
			sourceTrackId: track.id,
			targetTrackId: trackId,
			effectIds: (track.effects ?? []).map((effect, index) => ({ sourceId: effect.id, targetId: effects[index]!.id })),
		};
		if (track.laneGroupId && !laneGroups.has(track.laneGroupId)) laneGroups.set(track.laneGroupId, runtime.createStableId('lane-group'));
		const labels = track.type === 'label' ? duplicateLabels(runtime, track.labels ?? [], range) : undefined;
		commands.push({
			...createAddTrackCommand({
				...structuredClone(track), id: trackId, armed: false, effects, clipIds: [],
				laneGroupId: track.laneGroupId ? laneGroups.get(track.laneGroupId) : null,
				...(labels ? { labels } : {}),
			}),
			...duplicatePlacement(project, track.id),
			...(track.type === 'audio' ? {
				productionDuplicate: runtime.prepareTrackDuplicateCarrier?.(project, request) ?? {
					sourceTrackId: request.sourceTrackId, effectIds: request.effectIds,
				},
			} : {}),
		});
	}
	const paste = preparePasteCommand(clipboard, { atFrame: range.startFrame, trackMap, mode: 'overlap' }, runtime.createStableId);
	const clipIds = Object.values(paste.clipIds ?? {});
	const trackIds = [...sourceTracks.map((track) => track.id), ...sourceTracks.map((track) => trackMap[track.id]!)];
	commands.push(paste, {
		type: 'selection/set',
		startFrame: range.exactClips ? 0 : range.startFrame,
		endFrame: range.exactClips ? 0 : range.endFrame,
		trackIds,
		clipIds: range.exactClips ? [...range.clipIds ?? [], ...clipIds] : [],
		frequencyRange: range.frequencyRange ?? null,
	});
	return { command: { type: 'batch', commands }, selectTrackId: trackMap[sourceTracks[0]!.id]!, selectClipId: range.exactClips ? clipIds[0] ?? null : null };
}

function duplicateLabels(runtime: DuplicateSelectionRuntime, labels: readonly DuplicateLabel[], range: DuplicateSelectionRange) {
	return labels.flatMap((label) => {
		const startFrame = label.startFrame;
		const endFrame = label.endFrame ?? startFrame;
		if (startFrame === undefined || endFrame === undefined) return [];
		const point = startFrame === endFrame;
		if (point ? startFrame < range.startFrame || startFrame > range.endFrame : endFrame <= range.startFrame || startFrame >= range.endFrame) return [];
		return [{ ...structuredClone(label), id: runtime.createStableId('label'),
			startFrame: Math.max(startFrame, range.startFrame), endFrame: Math.min(endFrame, range.endFrame),
		}];
	});
}

function duplicatePlacement(project: DuplicateProject, sourceTrackId: string) {
	if (!project.trackFolders?.length) return {};
	for (const sequence of project.sequences ?? []) {
		const node = sequence.trackNodes?.find((candidate) => candidate.id === sourceTrackId);
		if (node || sequence.trackIds?.includes(sourceTrackId)) return { sequenceId: sequence.id, parentFolderId: node?.parentFolderId ?? null };
	}
	return {};
}
