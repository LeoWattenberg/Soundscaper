/* SPDX-License-Identifier: AGPL-3.0-only */

import { isProjectFileName } from '../../../../project-file-extensions.ts';
import { planClipSpreadsheetEdits, type ClipSpreadsheetEdit } from '../../../clip-spreadsheet.ts';
import {
	findMissingClipSpreadsheetSources, planClipSpreadsheetInsert,
	type ClipSpreadsheetInsertSource, type ClipSpreadsheetNewRow,
} from '../../../clip-spreadsheet-insert.ts';
import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import { peakCacheKey } from '../../../source-analysis-cache.ts';
import { isAudioEditorVideoFile } from '../../../video-media.js';
import {
	EDITOR_PROJECT_TASK_SCOPE, isCurrentAssertion,
	type EditorControllerLifetime, type EditorProjectToken,
} from '../../shared/lifecycle.ts';
import type { EditorTaskProgressCoordinator } from '../../shared/task-progress.ts';
import type { ProjectBinProject } from '../project-bin-types.ts';

export interface ClipSpreadsheetImportFile {
	readonly reference: string;
	readonly file: File;
}

interface SourceCache { delete(id: string): unknown }

export interface ClipSpreadsheetPasteDependencies {
	readonly lifetime: EditorControllerLifetime;
	readonly taskProgress: Pick<EditorTaskProgressCoordinator, 'begin'>;
	readonly importingLabel: string;
	readonly protectedSourceIds: Set<string>;
	readonly sourceBuffers: SourceCache;
	readonly sourcePeaks: SourceCache;
	readonly missingSourceIds: SourceCache & { has(id: string): boolean };
	readonly store: {
		deleteSource(id: string): Promise<unknown>;
		deleteAnalysis?(key: string): Promise<unknown>;
	};
	getProject(): ProjectBinProject | null;
	captureProject(): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	editingBlocked(): boolean;
	setImporting(value: boolean): void;
	createId(prefix: string): string;
	commit(command: AudioEditorCommand): unknown;
	prepareAudioSource(file: File, options: Readonly<{
		signal: AbortSignal;
		onSourcePrepared(sourceId: string): void;
	}>): Promise<ClipSpreadsheetInsertSource>;
	retireSourceChunkProvider(id: string): PromiseLike<unknown> | unknown;
	publish(): void;
}

/** Imports use the normal decoder and storage admission, then join the paste's single undo entry. */
export function createClipSpreadsheetPasteService(dependencies: ClipSpreadsheetPasteDependencies) {
	return async function pasteSpreadsheet(
		projectId: string,
		requestedEdits: readonly ClipSpreadsheetEdit[],
		requestedRows: readonly ClipSpreadsheetNewRow[],
		files: readonly ClipSpreadsheetImportFile[] = [],
	): Promise<unknown> {
		dependencies.lifetime.assertActive();
		const project = dependencies.getProject();
		if (!project || project.id !== projectId) throw new RangeError('The spreadsheet project is no longer open.');
		if (dependencies.editingBlocked()) throw new RangeError('Clip editing is currently unavailable.');
		const edits = requestedEdits.map(edit => ({ ...edit }));
		const rows = requestedRows.map(row => ({ ...row }));
		const editCommand = planClipSpreadsheetEdits(project, edits);
		const missing = findMissingClipSpreadsheetSources(project, rows);
		const sourcesById = new Map(project.sources.map(source => [source.id, source]));
		const sourcesByName = new Map(project.sources.map(source => [Reflect.get(source, 'name') as unknown, source]));
		for (const row of rows) {
			const reference = row.source?.trim();
			const source = (reference ? sourcesById.get(reference) : undefined) ?? sourcesByName.get(reference);
			if (source && dependencies.missingSourceIds.has(source.id)) throw new RangeError(`Relink the missing source before pasting clips: ${reference ?? source.id}`);
		}
		const fileByReference = validatedFiles(files);
		for (const reference of missing) {
			if (!fileByReference.has(reference)) throw new RangeError(`Select the source file: ${reference}`);
		}
		if (!missing.length) {
			const insertCommand = planClipSpreadsheetInsert(project, rows, { createId: dependencies.createId });
			const command = combineCommands(editCommand, insertCommand);
			return command ? dependencies.commit(command) : null;
		}

		const projectToken = dependencies.captureProject();
		const lifetimeToken = dependencies.lifetime.capture();
		const task = dependencies.lifetime.startTask('clip-spreadsheet-paste', { scope: EDITOR_PROJECT_TASK_SCOPE });
		const progress = dependencies.taskProgress.begin('import', dependencies.importingLabel, null, { key: 'importing' });
		progress.setCancellation(() => task.abort(new DOMException('The spreadsheet paste was cancelled.', 'AbortError')));
		const sources: ClipSpreadsheetInsertSource[] = [];
		const stagedSourceIds = new Set<string>();
		const resolvedSourceIds = new Map<string, string>();
		const importedFiles = new Map<File, string>();
		let importingHeld = true;
		const ownsProject = () => isCurrentAssertion(() => {
			dependencies.lifetime.assertActive(lifetimeToken);
			dependencies.assertProject(projectToken);
		});
		const assertCurrent = () => {
			task.assertCurrent(); dependencies.assertProject(projectToken);
			if (dependencies.getProject() !== project) throw new Error('The project changed before the spreadsheet paste could finish.');
		};
		dependencies.setImporting(true);
		dependencies.publish();
		try {
			for (const reference of missing) {
				assertCurrent();
				const file = fileByReference.get(reference)!;
				const reused = importedFiles.get(file);
				if (reused) { resolvedSourceIds.set(reference, reused); continue; }
				const source = await dependencies.prepareAudioSource(file, {
					signal: task.signal,
					onSourcePrepared: sourceId => {
						if (!sourceId || sourcesById.has(sourceId)) throw new Error('An imported spreadsheet source requires a fresh source ID.');
						stagedSourceIds.add(sourceId);
						dependencies.protectedSourceIds.add(sourceId);
					},
				});
				assertCurrent();
				if (!stagedSourceIds.has(source.id)) throw new Error(`The imported audio source is unavailable: ${reference}`);
				if ((source.kind ?? 'audio') !== 'audio' || !source.sampleRate || !source.frameCount || !source.channelCount) {
					throw new RangeError('Spreadsheet rows require a valid audio source.');
				}
				sources.push(source);
				resolvedSourceIds.set(reference, source.id);
				importedFiles.set(file, source.id);
				progress.update(importedFiles.size / missing.length);
			}
			assertCurrent();
			const insertCommand = planClipSpreadsheetInsert(project, rows, {
				createId: dependencies.createId, additionalSources: sources, resolvedSourceIds: Object.fromEntries(resolvedSourceIds),
			});
			dependencies.setImporting(false);
			importingHeld = false;
			if (dependencies.editingBlocked()) throw new RangeError('Clip editing is currently unavailable.');
			assertCurrent();
			const command = combineCommands(editCommand, insertCommand);
			const result = command ? dependencies.commit(command) : null;
			return result;
		} catch (error) {
			const cleanupErrors = await discardSources(stagedSourceIds, dependencies);
			if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], 'Spreadsheet paste and imported-source cleanup failed.', { cause: error });
			throw error;
		} finally {
			for (const id of stagedSourceIds) dependencies.protectedSourceIds.delete(id);
			if (ownsProject()) {
				if (importingHeld) dependencies.setImporting(false);
				dependencies.publish();
			}
			progress.finish(); task.finish();
		}
	};
}

function validatedFiles(files: readonly ClipSpreadsheetImportFile[]): Map<string, File> {
	const result = new Map<string, File>();
	for (const { reference, file } of files) {
		const key = reference.trim();
		if (!key || result.has(key)) throw new RangeError('Every selected spreadsheet file needs one unique source reference.');
		if (!file || typeof file.name !== 'string' || typeof file.arrayBuffer !== 'function'
			|| isAudioEditorVideoFile(file) || file.type.startsWith('image/')
			|| isProjectFileName(file.name) || /\.(?:aup[34]?|sesx|dawproject|rpp|otio|fcpxml|xml|zip)$/iu.test(file.name)) {
			throw new TypeError(`Select an audio file for ${reference}.`);
		}
		result.set(key, file);
	}
	return result;
}

function combineCommands(...commands: readonly (AudioEditorCommand | null)[]): AudioEditorCommand | null {
	const selected = commands.filter(command => command !== null);
	return selected.length ? { type: 'batch', commands: selected } : null;
}

async function discardSources(sourceIds: ReadonlySet<string>, dependencies: ClipSpreadsheetPasteDependencies): Promise<unknown[]> {
	const failures: unknown[] = [];
	for (const id of sourceIds) {
		try { await dependencies.retireSourceChunkProvider(id); }
		catch (error) { failures.push(error); continue; }
		dependencies.sourceBuffers.delete(id);
		dependencies.sourcePeaks.delete(id);
		dependencies.missingSourceIds.delete(id);
		try { await dependencies.store.deleteAnalysis?.(peakCacheKey(id)); }
		catch (error) { failures.push(error); }
		try { await dependencies.store.deleteSource(id); }
		catch (error) { failures.push(error); }
	}
	return failures;
}
