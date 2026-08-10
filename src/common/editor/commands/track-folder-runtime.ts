/* SPDX-License-Identifier: AGPL-3.0-only */

import { isTrackFolderProjectSchema } from '../project-schema-version.ts';
import { createTrackFolderV12, type TrackFolderV12 } from '../track-folder-v12.ts';
import {
	insertTrackNodeV12,
	moveTrackNodeV12,
	removeTrackNodeV12,
	trackNodeLaneGroupsV12,
	type MutableHierarchySequenceV12,
} from '../track-hierarchy-mutation-v12.ts';
import { FOLDER_AWARE_TRACK_STRUCTURE_EDIT } from './command-projection-transients.ts';
import {
	defineTrackFolderCommandHandlers,
	type TrackFolderCommandHandlers,
} from './track-folder.ts';
import { removeTracksAndDependents } from './track-mixer-label-runtime.js';
import type { CommandObject, EditorCommandProject } from './protocol.ts';

interface MutableTrackFolderProject extends Record<PropertyKey, unknown> {
	schemaVersion: number;
	trackFolders: TrackFolderV12[];
	tracks: readonly Readonly<{ readonly id?: unknown; readonly laneGroupId?: unknown }>[];
	sequences: MutableHierarchySequenceV12[];
	mixer?: {
		groups?: Readonly<{ readonly id?: unknown }>[];
		sends?: readonly Readonly<{ readonly id?: unknown }>[];
		routes?: Record<string, { groupId?: unknown }>;
	};
}

const RUNTIME_HANDLERS = defineTrackFolderCommandHandlers({
	'track-folder/add': (project, command) => addTrackFolder(
		folderProject(project),
		command.folder,
		command.sequenceId,
		command.parentFolderId ?? null,
		command.index,
	),
	'track-folder/update': (project, command) => updateTrackFolder(
		folderProject(project),
		command.folderId,
		command.changes,
	),
	'track-folder/remove': (project, command) => removeTrackFolder(
		folderProject(project),
		command.folderId,
		command.disposition,
	),
	'track-node/move': (project, command) => moveTrackNode(
		folderProject(project),
		command.sequenceId,
		command.nodeId,
		command.parentFolderId ?? null,
		command.index,
	),
});

export function createTrackFolderRuntimeHandlers(): Readonly<TrackFolderCommandHandlers> {
	return RUNTIME_HANDLERS;
}

/**
 * Admit the draft and mark it folder-aware so reconciliation re-derives the
 * hierarchy preorder and folder bus ownership instead of applying the legacy
 * root-track rules.
 */
function folderProject(project: EditorCommandProject): MutableTrackFolderProject {
	const candidate = project as MutableTrackFolderProject;
	if (!isTrackFolderProjectSchema(candidate.schemaVersion)) {
		throw new RangeError('Track folder commands require a track folder document schema.');
	}
	candidate[FOLDER_AWARE_TRACK_STRUCTURE_EDIT] = true;
	return candidate;
}

function addTrackFolder(
	project: MutableTrackFolderProject,
	value: CommandObject,
	sequenceId: string,
	parentFolderId: string | null,
	index: number | undefined,
): void {
	const folder = createTrackFolderV12(value);
	if (project.trackFolders.some((candidate) => candidate.id === folder.id)) {
		throw new RangeError(`Duplicate track folder ID: ${folder.id}.`);
	}
	const buses = [...(project.mixer?.groups ?? []), ...(project.mixer?.sends ?? [])];
	if (buses.some((bus) => String(bus.id) === folder.id)) {
		throw new RangeError(`Track folder ID collides with mixer bus ${folder.id}.`);
	}
	insertTrackNodeV12(project.sequences, {
		sequenceId,
		node: { kind: 'folder', id: folder.id, parentFolderId: null },
		parentFolderId,
		index: index ?? Number.MAX_SAFE_INTEGER,
	});
	project.trackFolders.push(folder);
}

function updateTrackFolder(
	project: MutableTrackFolderProject,
	folderId: string,
	changes: CommandObject,
): void {
	const index = project.trackFolders.findIndex((candidate) => candidate.id === folderId);
	if (index < 0) throw new ReferenceError(`Unknown track folder: ${folderId}.`);
	if (Object.hasOwn(changes, 'id') && changes.id !== folderId) {
		throw new RangeError('Track folder identity is immutable.');
	}
	project.trackFolders[index] = createTrackFolderV12({
		...project.trackFolders[index],
		...changes,
		id: folderId,
	});
}

function removeTrackFolder(
	project: MutableTrackFolderProject,
	folderId: string,
	disposition: 'promote' | 'delete-contents',
): void {
	if (disposition !== 'promote' && disposition !== 'delete-contents') {
		throw new RangeError('Track folder removal requires an explicit promote or delete-contents disposition.');
	}
	if (!project.trackFolders.some((candidate) => candidate.id === folderId)) {
		throw new ReferenceError(`Unknown track folder: ${folderId}.`);
	}
	const sequence = project.sequences.find(
		(candidate) => candidate.trackNodes.some((node) => node.id === folderId),
	);
	if (!sequence) throw new ReferenceError(`Track folder ${folderId} is not part of any sequence.`);
	const result = removeTrackNodeV12(project.sequences, {
		sequenceId: sequence.id,
		nodeId: folderId,
		disposition,
	}, trackNodeLaneGroupsV12(project.tracks));
	const removedFolderIds = new Set(result.removedFolderIds);
	project.trackFolders = project.trackFolders.filter(({ id }) => !removedFolderIds.has(id));
	if (result.removedTrackIds.length > 0) {
		removeTracksAndDependents(project, result.removedTrackIds);
	}
	// A removed folder takes its owned bus with it: once the folder record is
	// gone the reconciler cannot tell that bus from an ordinary one, so the
	// removal that knows the identities retires them and detaches their routes.
	if (project.mixer?.groups) {
		project.mixer.groups = project.mixer.groups.filter((bus) => !removedFolderIds.has(String(bus.id)));
		for (const route of Object.values(project.mixer.routes ?? {})) {
			if (route.groupId != null && removedFolderIds.has(String(route.groupId))) route.groupId = null;
		}
	}
}

function moveTrackNode(
	project: MutableTrackFolderProject,
	sequenceId: string,
	nodeId: string,
	parentFolderId: string | null,
	index: number,
): void {
	moveTrackNodeV12(project.sequences, {
		sequenceId,
		nodeId,
		parentFolderId,
		index,
	}, trackNodeLaneGroupsV12(project.tracks));
}
