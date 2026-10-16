/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ClipSpreadsheetInsertSource } from '../../../clip-spreadsheet-insert.ts';
import type { AudioEditorCommand, CommandObject } from '../../../commands/protocol.ts';
import { createProjectImportService } from './project-import-service.ts';
import type { ProjectImportRuntime } from './project-import-runtime.ts';
import { resolveMediaImportVideoRoute } from './media-import-video-route.ts';

export interface ClipSpreadsheetSourcePreparationOptions {
	readonly signal: AbortSignal;
	onSourcePrepared(sourceId: string): void;
}

type ImportServiceFactory = (runtime: ProjectImportRuntime) => Pick<ReturnType<typeof createProjectImportService>, 'importFile'>;

/** Prepare stored media without adding a bin clip or changing any document state. */
export function createClipSpreadsheetSourcePreparer(
	runtime: ProjectImportRuntime,
	createImportService: ImportServiceFactory = createProjectImportService,
) {
	return async (file: File, options: ClipSpreadsheetSourcePreparationOptions): Promise<ClipSpreadsheetInsertSource> => {
		options.signal.throwIfAborted();
		if (runtime.isLegacyAupFile(file)) {
			throw new RangeError('Spreadsheet rows can import only audio files.');
		}
		const project = runtime.getProject();
		if (!project) throw new Error('Audio source preparation requires an open project.');
		const prepared: ClipSpreadsheetInsertSource[] = [];
		const assertCurrent = () => {
			options.signal.throwIfAborted();
			if (runtime.getProject() !== project) throw new Error('The project changed during audio source preparation.');
		};
		if (await resolveMediaImportVideoRoute(file, runtime.isAudioEditorVideoFile(file), options.signal, assertCurrent)) {
			throw new RangeError('Spreadsheet rows can import only audio files.');
		}
		const rejectDocumentMutation = (): never => {
			throw new Error('Document changes are unavailable during audio source preparation.');
		};
		const service = createImportService({
			...runtime,
			importVideoFile: rejectDocumentMutation,
			switchProject: rejectDocumentMutation,
			publishDocumentSnapshot: rejectDocumentMutation,
			commit(command) {
				const commands = flattenCommands(command);
				const sources = commands.filter(value => value.type === 'source/add').map(value => value.source);
				// Register every persisted source before validation or cancellation can fail.
				for (const source of sources) {
					if (typeof source.id === 'string' && source.id) options.onSourcePrepared(source.id);
				}
				assertCurrent();
				if (prepared.length || sources.length !== 1 || commands.some(value => (
					value.type !== 'source/add' && value.type !== 'metadata/update' && value.type !== 'project-bin/add'
				))) throw new Error('Audio source preparation requires exactly one valid audio source.');
				prepared.push(preparedSource(sources[0]!));
				return project;
			},
		});
		await service.importFile(file, { destination: 'project-bin', signal: options.signal }, assertCurrent);
		assertCurrent();
		if (prepared.length !== 1) throw new Error('Audio source preparation requires exactly one valid audio source.');
		return prepared[0]!;
	};
}

function flattenCommands(command: AudioEditorCommand): Exclude<AudioEditorCommand, { type: 'batch' }>[] {
	return command.type === 'batch' ? command.commands.flatMap(flattenCommands) : [command];
}

function preparedSource(source: CommandObject): ClipSpreadsheetInsertSource {
	const { id, name, sampleRate, frameCount, channelCount, kind } = source;
	if (typeof id !== 'string' || !id.trim() || typeof name !== 'string' || !name.trim()
		|| !positiveInteger(sampleRate) || !positiveInteger(frameCount) || !positiveInteger(channelCount)
		|| (kind !== undefined && kind !== 'audio')) {
		throw new RangeError('Audio source preparation requires exactly one valid audio source.');
	}
	return { ...source, id, name, sampleRate, frameCount, channelCount, ...(kind === 'audio' ? { kind } : {}) };
}

function positiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
