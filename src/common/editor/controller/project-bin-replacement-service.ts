/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAddSourceCommand } from '../commands/factories.ts';
import type { AudioEditorCommand, CommandObject } from '../commands/protocol.ts';
import type {
	EditorControllerLifetime,
	EditorProjectToken,
	EditorTaskScope,
} from './lifecycle.ts';
import {
	findProjectBinClip,
	findProjectBinSource,
	projectBinClips,
	projectBinMediaKind,
	type ProjectBinClip,
	type ProjectBinCopy,
	type ProjectBinDocumentSnapshot,
	type ProjectBinImportResult,
	type ProjectBinProject,
	type ProjectBinReplacementEntry,
	type ProjectBinReplacementPreparation,
	type ProjectBinReplacementShortfallMode,
	type ProjectBinSource,
} from './project-bin-types.ts';

const PROJECT_BIN_REPLACEMENT_TASK = 'project-bin-replacement';

interface ReplacementStage {
	readonly projectId: string;
	readonly baseProject: ProjectBinProject;
	readonly clipId: string;
	readonly replacements: readonly ProjectBinReplacementEntry[];
	readonly sources: readonly ProjectBinSource[];
	readonly templates: readonly ProjectBinClip[];
}

export interface ProjectBinStoragePort {
	deleteSource(sourceId: string): Promise<unknown>;
	deleteMediaAsset?(sourceId: string): Promise<unknown>;
}

export interface ProjectBinCachePort {
	delete(sourceId: string): boolean;
}

export interface ProjectBinChunkProviderCachePort extends Map<string, unknown> {
	drain(): PromiseLike<void> | void;
}

export interface ProjectBinReplacementDependencies {
	readonly lifetime: EditorControllerLifetime;
	readonly copy: Pick<ProjectBinCopy, 'audioClipNotFound' | 'projectBinReplacementIncompatible'>;
	readonly sourceBuffers: ProjectBinCachePort;
	readonly sourcePeaks: ProjectBinCachePort;
	readonly missingSourceIds: ProjectBinCachePort;
	readonly store: ProjectBinStoragePort;
	createId(prefix: string): string;
	captureProject(): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	getProject(): ProjectBinProject;
	editingBlocked(): boolean;
	commit(command: AudioEditorCommand): unknown;
	captureActiveDocument(): ProjectBinDocumentSnapshot;
	restoreActiveDocument(snapshot: ProjectBinDocumentSnapshot): void;
	setImporting(importing: boolean): void;
	importProjectBinFile(
		file: unknown,
		options: Readonly<{ signal: AbortSignal }>,
	): Promise<ProjectBinImportResult | null>;
	projectChanged(): void;
	publish(): void;
	revokeVideoVisual(sourceId: string): PromiseLike<unknown> | unknown;
	retireSourceChunkProvider(sourceId: string): PromiseLike<void> | void;
}

export interface ProjectBinReplacementService {
	prepareProjectBinReplacement(clipId: string, file: unknown): Promise<ProjectBinReplacementPreparation | null>;
	applyProjectBinReplacement(token: string, shortfallMode?: ProjectBinReplacementShortfallMode): string | null;
	cancelProjectBinReplacement(token: string): Promise<boolean>;
	cancelAllProjectBinReplacements(): Promise<void>;
}

export function createProjectBinReplacementService(
	dependencies: ProjectBinReplacementDependencies,
): Readonly<ProjectBinReplacementService> {
	const stages = new Map<string, ReplacementStage>();
	const assertCurrent = (task: EditorTaskScope, projectToken: EditorProjectToken): void => {
		task.assertCurrent();
		dependencies.assertProject(projectToken);
	};

	return Object.freeze({
		prepareProjectBinReplacement,
		applyProjectBinReplacement,
		cancelProjectBinReplacement,
		cancelAllProjectBinReplacements,
	});

	async function prepareProjectBinReplacement(
		clipId: string,
		file: unknown,
	): Promise<ProjectBinReplacementPreparation | null> {
		dependencies.lifetime.assertActive();
		if (!file || dependencies.editingBlocked()) return null;
		const baseDocument = dependencies.captureActiveDocument();
		const baseProject = baseDocument.project;
		const target = findProjectBinClip(baseProject, clipId);
		if (!target) throw new Error(dependencies.copy.audioClipNotFound);
		const projectToken = dependencies.captureProject();
		const task = dependencies.lifetime.startTask(PROJECT_BIN_REPLACEMENT_TASK);
		let restored = false;
		dependencies.setImporting(true);
		dependencies.publish();
		try {
			const result = await dependencies.importProjectBinFile(file, { signal: task.signal });
			assertCurrent(task, projectToken);
			const importedProject = dependencies.getProject();
			restoreBaseDocument(baseDocument);
			if (!result) return null;
			const importedClip = findProjectBinClip(importedProject, result.clipId);
			const importedItemClips = importedClip && importedProject.schemaVersion >= 4
				? projectBinClips(importedProject).filter((clip) => clip.binItemId === importedClip.binItemId)
				: importedClip ? [importedClip] : [];
			const targetItemClips = baseProject.schemaVersion >= 4
				? projectBinClips(baseProject).filter((clip) => clip.binItemId === target.binItemId)
				: [target];
			const importedKinds = importedItemClips.map(projectBinMediaKind).sort();
			const targetKinds = targetItemClips.map(projectBinMediaKind).sort();
			const importedSources = importedItemClips
				.map((clip) => findProjectBinSource(importedProject, clip.sourceId))
				.filter((source): source is ProjectBinSource => Boolean(source));
			if (!sameKinds(importedKinds, targetKinds) || importedSources.length !== targetItemClips.length) {
				await discardImportedReplacement(importedSources);
				assertCurrent(task, projectToken);
				throw new Error(dependencies.copy.projectBinReplacementIncompatible
					|| 'The replacement file is not compatible with this Project Bin item.');
			}
			const importedByKind = new Map(importedItemClips.map((clip) => [projectBinMediaKind(clip), clip]));
			const replacements = targetItemClips.map((clip): ProjectBinReplacementEntry => ({
				oldSourceId: clip.sourceId,
				newSourceId: requireImportedKind(importedByKind, projectBinMediaKind(clip)).sourceId,
			}));
			const newSourceByOldId = new Map(replacements.map((entry) => [
				entry.oldSourceId,
				findProjectBinSource(importedProject, entry.newSourceId),
			]));
			const sourceIds = new Set(replacements.map((entry) => entry.oldSourceId));
			const affectedClips = [...baseProject.clips, ...projectBinClips(baseProject)]
				.filter((clip) => sourceIds.has(clip.sourceId));
			const shortenedClipIds = affectedClips.filter((clip) => {
				const oldSource = findProjectBinSource(baseProject, clip.sourceId);
				const newSource = newSourceByOldId.get(clip.sourceId);
				if (!oldSource || !newSource) return true;
				const newRate = Math.max(1, newSource.sampleRate || baseProject.sampleRate);
				const oldRate = Math.max(1, oldSource.sampleRate || baseProject.sampleRate);
				const start = Math.round(clip.sourceStartFrame / oldRate * newRate);
				const duration = Math.round(clip.sourceDurationFrames / oldRate * newRate);
				return start + duration > newSource.frameCount;
			}).map((clip) => clip.id);
			assertCurrent(task, projectToken);
			const token = dependencies.createId('project-bin-replacement');
			stages.set(token, Object.freeze({
				projectId: baseProject.id,
				baseProject,
				clipId,
				replacements: Object.freeze(replacements),
				sources: Object.freeze(importedSources),
				templates: Object.freeze(importedItemClips),
			}));
			return Object.freeze({
				token,
				requiresChoice: shortenedClipIds.some((id) => baseProject.clips.some((clip) => clip.id === id)),
				shortenedClipIds: Object.freeze(shortenedClipIds),
			});
		} finally {
			if (!restored && taskOwnsWork(task)) {
				let projectIsCurrent = true;
				try {
					dependencies.assertProject(projectToken);
				} catch {
					projectIsCurrent = false;
				}
				if (projectIsCurrent) restoreBaseDocument(baseDocument);
				// A switched project must not be replaced by this task's saved document.
				else dependencies.setImporting(false);
			}
			task.finish();
		}

		function restoreBaseDocument(snapshot: ProjectBinDocumentSnapshot): void {
			dependencies.restoreActiveDocument(snapshot);
			dependencies.setImporting(false);
			dependencies.projectChanged();
			dependencies.publish();
			restored = true;
		}
	}

	function applyProjectBinReplacement(
		token: string,
		shortfallMode: ProjectBinReplacementShortfallMode = 'keep-spacing',
	): string | null {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const stage = stages.get(token);
		if (!stage) throw new Error('The staged Project Bin replacement is no longer available.');
		const project = dependencies.getProject();
		if (project !== stage.baseProject || project.id !== stage.projectId) {
			void cancelProjectBinReplacement(token);
			throw new Error('The project changed before the replacement could be applied.');
		}
		const commands: AudioEditorCommand[] = [
			...stage.sources.map((source) => createAddSourceCommand({ ...source })),
			{
				type: 'project-bin/replace-media',
				clipId: stage.clipId,
				replacements: stage.replacements,
				templates: stage.templates.map(toCommandObject),
				shortfallMode,
			},
		];
		dependencies.commit({ type: 'batch', commands });
		stages.delete(token);
		return stage.clipId;
	}

	async function cancelProjectBinReplacement(token: string): Promise<boolean> {
		const stage = stages.get(token);
		if (!stage) return false;
		stages.delete(token);
		await discardImportedReplacement(stage.sources);
		return true;
	}

	async function cancelAllProjectBinReplacements(): Promise<void> {
		dependencies.lifetime.cancelTask(PROJECT_BIN_REPLACEMENT_TASK);
		for (const token of [...stages.keys()]) await cancelProjectBinReplacement(token);
	}

	async function discardImportedReplacement(sources: readonly ProjectBinSource[]): Promise<void> {
		for (const source of sources) {
			if (source.kind === 'video') await dependencies.revokeVideoVisual(source.id);
		}
		for (const source of sources) {
			await dependencies.retireSourceChunkProvider(source.id);
		}
		for (const source of sources) {
			dependencies.sourceBuffers.delete(source.id);
			dependencies.sourcePeaks.delete(source.id);
			dependencies.missingSourceIds.delete(source.id);
		}
		for (const source of sources) {
			if (source.kind === 'video') {
				try {
					await dependencies.store.deleteMediaAsset?.(source.id);
				} catch {
					// Replacement staging is best-effort cleanup of an unreferenced asset.
				}
			} else {
				try {
					await dependencies.store.deleteSource(source.id);
				} catch {
					// Replacement staging is best-effort cleanup of an unreferenced source.
				}
			}
		}
	}
}

function requireImportedKind(
	clips: ReadonlyMap<'audio' | 'video', ProjectBinClip>,
	kind: 'audio' | 'video',
): ProjectBinClip {
	const clip = clips.get(kind);
	if (!clip) throw new Error(`The imported Project Bin item is missing its ${kind} clip.`);
	return clip;
}

function sameKinds(first: readonly string[], second: readonly string[]): boolean {
	return first.length === second.length && first.every((kind, index) => kind === second[index]);
}

function taskOwnsWork(task: EditorTaskScope): boolean {
	try {
		task.assertCurrent();
		return true;
	} catch {
		return false;
	}
}

function toCommandObject(clip: ProjectBinClip): CommandObject {
	return { ...clip };
}
