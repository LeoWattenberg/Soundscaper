/* SPDX-License-Identifier: AGPL-3.0-only */

import { applyEditorCommand } from '../commands.js';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import type { AudioEditorProjectV17 } from '../project-v17-validation.ts';
import { serializeScapeProjectDocument } from '../scape-project-document.ts';
import type { TakeCyclePublishedProject } from './take-cycle-recording-repository-composition.ts';

export interface TakeCyclePublicationHistory {
	readonly limit: number;
	readonly present: AudioEditorProjectV17;
	readonly undoStack: readonly Readonly<{
		readonly project: AudioEditorProjectV17;
		readonly command: AudioEditorCommand;
	}>[];
	readonly redoStack: readonly Readonly<{
		readonly project: AudioEditorProjectV17;
		readonly command: AudioEditorCommand;
	}>[];
}

export interface TakeCyclePublicationSession {
	captureProjectHistory(projectId: string): Readonly<{
		readonly history: TakeCyclePublicationHistory;
		readonly token: unknown;
	}>;
	assertProjectHistoryToken(projectId: string, token: unknown): unknown;
	updateProjectHistory(
		projectId: string,
		history: TakeCyclePublicationHistory,
		options: Readonly<{ readonly dirty: false }>,
	): unknown;
	getProjectHistory(projectId: string): TakeCyclePublicationHistory;
	markProjectSaved(projectId: string): unknown;
}

export interface TakeCycleCurrentProjectPublicationDependencies {
	readonly session: TakeCyclePublicationSession;
	readonly applyProjectCommand?: (
		project: AudioEditorProjectV17,
		command: AudioEditorCommand,
		options?: Readonly<{ readonly now?: Date | string }>,
	) => AudioEditorProjectV17;
	getActiveProject(): AudioEditorProjectV17 | null;
	getActiveHistory(): TakeCyclePublicationHistory | null;
	setActiveProject(project: AudioEditorProjectV17): void;
	setActiveHistory(history: TakeCyclePublicationHistory): void;
	isActiveProject(projectId: string): boolean;
	synchronizeProject(project: AudioEditorProjectV17): PromiseLike<void> | void;
}

export interface TakeCycleCurrentProjectPublicationService {
	publish(publication: TakeCyclePublishedProject): Promise<void>;
}

/** Synchronize an already-durable exact CAS target into the active editor tab. */
export function createTakeCycleCurrentProjectPublicationService(
	dependencies: TakeCycleCurrentProjectPublicationDependencies,
): Readonly<TakeCycleCurrentProjectPublicationService> {
	return Object.freeze({ publish });

	async function publish(publication: TakeCyclePublishedProject): Promise<void> {
		const { base, target } = publication;
		if (base.id !== target.id || !dependencies.isActiveProject(base.id)) {
			throw new Error('Take cycle publication does not own the exact active project.');
		}
		const active = dependencies.getActiveProject();
		const activeHistory = dependencies.getActiveHistory();
		if (!active || !activeHistory || active.id !== base.id || activeHistory.present.id !== base.id) {
			throw new Error('Take cycle publication requires one exact active project history.');
		}
		const capture = dependencies.session.captureProjectHistory(base.id);
		if (!sameProject(capture.history.present, activeHistory.present)
			|| !sameProject(active, activeHistory.present)) {
			throw new Error('Take cycle active project and session history diverged.');
		}
		const atBase = sameProject(active, base);
		const atTarget = sameProject(active, target);
		if (!atBase && !atTarget) {
			throw new Error('Active project does not match the exact take cycle base or target.');
		}

		let nextHistory: TakeCyclePublicationHistory;
		if (publication.command) {
			if (publication.reason !== 'finalize' || !atBase) {
				throw new Error('A live take cycle command requires the exact active base.');
			}
			assertCommandTarget(
				base,
				target,
				publication.command,
				dependencies.applyProjectCommand ?? applyEditorCommand,
			);
			nextHistory = Object.freeze({
				...capture.history,
				present: target,
				undoStack: Object.freeze([
					...capture.history.undoStack,
					Object.freeze({ project: base, command: publication.command }),
				].slice(-capture.history.limit)),
				redoStack: Object.freeze([]),
			});
		} else if (atBase) {
			nextHistory = Object.freeze({
				...capture.history,
				present: target,
				undoStack: Object.freeze([]),
				redoStack: Object.freeze([]),
			});
		} else nextHistory = capture.history;

		dependencies.session.assertProjectHistoryToken(base.id, capture.token);
		if (!dependencies.isActiveProject(base.id)) {
			throw new Error('Take cycle publication lost the active project before synchronization.');
		}
		if (!sameHistory(capture.history, nextHistory)) {
			dependencies.session.updateProjectHistory(base.id, nextHistory, { dirty: false });
		}
		dependencies.session.markProjectSaved(base.id);
		const synchronizedHistory = dependencies.session.getProjectHistory(base.id);
		if (!sameProject(synchronizedHistory.present, target)) {
			throw new Error('Session normalization changed the exact take cycle target.');
		}
		dependencies.setActiveHistory(synchronizedHistory);
		dependencies.setActiveProject(synchronizedHistory.present);
		await dependencies.synchronizeProject(synchronizedHistory.present);
		if (!dependencies.isActiveProject(base.id)
			|| !sameProject(dependencies.getActiveProject(), target)) {
			throw new Error('Take cycle publication was superseded during project synchronization.');
		}
	}
}

function assertCommandTarget(
	base: AudioEditorProjectV17,
	target: AudioEditorProjectV17,
	command: AudioEditorCommand,
	applyProjectCommand: NonNullable<TakeCycleCurrentProjectPublicationDependencies['applyProjectCommand']>,
): void {
	const applied = applyProjectCommand(base, command, { now: target.updatedAt });
	if (!sameProject(applied, target)) {
		throw new Error('Prepared take cycle command does not produce its exact durable target.');
	}
}

function sameProject(left: unknown, right: unknown): boolean {
	if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
	try {
		return serializeScapeProjectDocument(left as AudioEditorProjectV17)
			=== serializeScapeProjectDocument(right as AudioEditorProjectV17);
	} catch {
		return false;
	}
}

function sameHistory(
	left: TakeCyclePublicationHistory,
	right: TakeCyclePublicationHistory,
): boolean {
	return left === right || JSON.stringify(left) === JSON.stringify(right);
}
