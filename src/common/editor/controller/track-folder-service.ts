/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAddTrackFolderCommand,
	createMoveTrackNodeCommand,
	createRemoveTrackFolderCommand,
	createUpdateTrackFolderCommand,
} from '../commands/factories.ts';
import type { AudioEditorCommand, CommandObject } from '../commands/protocol.ts';
import type { EditorControllerLifetime } from './lifecycle.ts';

type RuntimeValue = string | number | boolean | null | undefined;

interface FolderedProjectShape {
	readonly trackFolders?: readonly Readonly<{ readonly id: string; readonly name: string }>[];
	readonly primarySequenceId?: string;
	readonly sequences?: readonly Readonly<{
		readonly id: string;
		readonly trackNodes: readonly Readonly<{
			readonly kind: 'folder' | 'track';
			readonly id: string;
			readonly parentFolderId: string | null;
		}>[];
	}>[];
}

export interface TrackFolderPlacement {
	readonly sequenceId?: string;
	readonly parentFolderId?: string | null;
	readonly index?: number;
}

export interface TrackFolderServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive'>;
	readonly getProject: () => unknown;
	readonly editingBlocked: () => boolean;
	readonly createId: (prefix: string) => string;
	readonly commit: (command: AudioEditorCommand) => unknown;
	readonly publishProjectState: () => void;
}

export interface TrackFolderService {
	createFolder(name?: RuntimeValue, placement?: TrackFolderPlacement): string | null;
	renameFolder(folderId: string, name: string): void;
	updateFolder(folderId: string, changes: CommandObject): void;
	toggleCollapsed(folderId: string): void;
	removeFolder(folderId: string, disposition: 'promote' | 'delete-contents'): void;
	moveNode(sequenceId: string, nodeId: string, parentFolderId: string | null, index: number): void;
	wrapTracksIntoFolder(trackIds: readonly string[], name?: RuntimeValue): string | null;
	selectFolder(folderId: string | null): void;
	selectedFolderId(): string | null;
}

/**
 * Folder editing over the folder-aware command set. Folder selection is
 * controller session state, never document state: persisting it would be a
 * schema concern for no benefit, and the tree can rebuild it from any row.
 */
export function createTrackFolderService(
	dependencies: TrackFolderServiceDependencies,
): Readonly<TrackFolderService> {
	let selectedFolderId: string | null = null;

	const project = (): FolderedProjectShape => dependencies.getProject() as FolderedProjectShape;
	const guard = (): void => {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) throw new RangeError('Editing is blocked.');
	};
	const folderName = (name: RuntimeValue): string => {
		if (typeof name === 'string' && name.trim()) return name;
		const count = project().trackFolders?.length ?? 0;
		return `Folder ${String(count + 1)}`;
	};

	return Object.freeze({
		createFolder(name?: RuntimeValue, placement: TrackFolderPlacement = {}): string | null {
			guard();
			const folderId = dependencies.createId('track-folder');
			const sequenceId = placement.sequenceId
				?? locateSelectedSequenceId(project(), selectedFolderId)
				?? String(project().primarySequenceId);
			dependencies.commit(createAddTrackFolderCommand(sequenceId, {
				id: folderId,
				name: folderName(name),
			}, {
				parentFolderId: placement.parentFolderId
					?? (selectedFolderId !== null && placement.sequenceId === undefined ? selectedFolderId : null),
				...(placement.index === undefined ? {} : { index: placement.index }),
			}));
			selectedFolderId = folderId;
			dependencies.publishProjectState();
			return folderId;
		},
		renameFolder(folderId: string, name: string): void {
			guard();
			dependencies.commit(createUpdateTrackFolderCommand(folderId, { name }));
			dependencies.publishProjectState();
		},
		updateFolder(folderId: string, changes: CommandObject): void {
			guard();
			dependencies.commit(createUpdateTrackFolderCommand(folderId, changes));
			dependencies.publishProjectState();
		},
		toggleCollapsed(folderId: string): void {
			guard();
			const node = project().trackFolders?.find(({ id }) => id === folderId) as
				| Readonly<{ collapsed?: boolean }>
				| undefined;
			if (!node) throw new ReferenceError(`Unknown track folder: ${folderId}.`);
			dependencies.commit(createUpdateTrackFolderCommand(folderId, { collapsed: node.collapsed !== true }));
			dependencies.publishProjectState();
		},
		removeFolder(folderId: string, disposition: 'promote' | 'delete-contents'): void {
			guard();
			dependencies.commit(createRemoveTrackFolderCommand(folderId, disposition));
			if (selectedFolderId === folderId) selectedFolderId = null;
			dependencies.publishProjectState();
		},
		moveNode(sequenceId: string, nodeId: string, parentFolderId: string | null, index: number): void {
			guard();
			dependencies.commit(createMoveTrackNodeCommand(sequenceId, nodeId, parentFolderId, index));
			dependencies.publishProjectState();
		},
		wrapTracksIntoFolder(trackIds: readonly string[], name?: RuntimeValue): string | null {
			guard();
			if (trackIds.length === 0) return null;
			const current = project();
			const location = locateNode(current, String(trackIds[0]));
			if (!location) throw new ReferenceError(`Unknown track: ${String(trackIds[0])}.`);
			const folderId = dependencies.createId('track-folder');
			dependencies.commit({
				type: 'batch',
				commands: [
					createAddTrackFolderCommand(location.sequenceId, {
						id: folderId,
						name: folderName(name),
					}, {
						parentFolderId: location.parentFolderId,
						index: location.childIndex,
					}),
					...trackIds.map((trackId, index) => createMoveTrackNodeCommand(
						location.sequenceId,
						String(trackId),
						folderId,
						index,
					)),
				],
			});
			selectedFolderId = folderId;
			dependencies.publishProjectState();
			return folderId;
		},
		selectFolder(folderId: string | null): void {
			dependencies.lifetime.assertActive();
			selectedFolderId = folderId;
		},
		selectedFolderId(): string | null {
			return selectedFolderId;
		},
	});
}

interface NodeLocation {
	readonly sequenceId: string;
	readonly parentFolderId: string | null;
	readonly childIndex: number;
}

function locateNode(project: FolderedProjectShape, nodeId: string): NodeLocation | null {
	for (const sequence of project.sequences ?? []) {
		const nodeIndex = sequence.trackNodes.findIndex((node) => node.id === nodeId);
		if (nodeIndex < 0) continue;
		const parentFolderId = sequence.trackNodes[nodeIndex].parentFolderId;
		let childIndex = 0;
		for (let cursor = 0; cursor < nodeIndex; cursor += 1) {
			if (sequence.trackNodes[cursor].parentFolderId === parentFolderId) childIndex += 1;
		}
		return { sequenceId: sequence.id, parentFolderId, childIndex };
	}
	return null;
}

function locateSelectedSequenceId(project: FolderedProjectShape, folderId: string | null): string | null {
	if (folderId === null) return null;
	for (const sequence of project.sequences ?? []) {
		if (sequence.trackNodes.some((node) => node.id === folderId)) return sequence.id;
	}
	return null;
}
