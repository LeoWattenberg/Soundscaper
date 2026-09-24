/* SPDX-License-Identifier: AGPL-3.0-only */

import { readDawprojectArchive, type DawprojectArchive, type DawprojectArchiveFile, writeDawprojectArchive, writeDawprojectArchiveToStream } from '../../../../dawproject-archive.ts'; import { createLocalizedError, setLocalizedStatus, type LocalizedPresentationMessage } from '../../../../../i18n/presentation-message.ts';
import { createDawprojectExport } from '../../../../dawproject-export.ts';
import {
	DAWPROJECT_FILE_EXTENSION,
	DAWPROJECT_MIME_TYPE,
	entryBaseName,
	isDawprojectFileName,
} from '../../../../dawproject-format.ts';
import { dawprojectMediaReferences, parseDawprojectDocument } from '../../../../dawproject-import.ts';
import { buildDawprojectProject, dawprojectImportedAudioMimeType, type DawprojectDecodedMediaInfo } from '../../../../dawproject-import-project.ts';
import { createCurrentAudioEditorProject } from '../../../../project-current.ts';
import { AUDIO_EDITOR_PCM_CHUNK_FRAMES } from '../../../../pcm-chunks.js';
import { admitAudioImportChannelCount } from '../audio-import-channel-admission.ts';
import { resolveDeliveredProject } from '../../../export/interchange-export-action.ts';
import { DAWPROJECT_BLOB_EXPORT_BYTE_LIMIT, dawprojectWavByteLength, dawprojectWavStream } from './dawproject-export-audio.ts';
import { assertDawprojectCompressedWorkingBudget, stageDawprojectCompressedSource } from './dawproject-import-compressed.ts';
import { inspectWavBlobPcm } from '../../../../wav-import.js';
import { createWavBlobPcmChunkReader, type WavBlobPcmChunkReader, type WavPcmDescriptor } from '../../../../wav-pcm-chunk-reader.ts';
import type { BlobLike } from '../../../../storage/media-records.ts';
import type { PreparedStreamedAudioImport } from '../../../../browser-streamed-audio-import.ts';

import type { EditorProjectToken, EditorTaskScope } from '../../../shared/lifecycle.ts';
import type {
	NativeProgress,
	NativeProjectAudioSource,
	NativeProjectDocument,
	NativeProjectFile,
	NativeProjectServiceRuntime,
	NativeSavedFile,
} from '../../../document/native-project-types.ts';

/**
 * DAWproject open and export, composed into the native project service.
 *
 * Open stages each source before building and switching to the project. A
 * failure leaves the previous project active and rolls back staged PCM.
 * Export follows the interchange path: the report is published before the
 * save dialog, so a cancelled save still leaves the omissions readable.
 *
 * The task-ownership helpers are the native service's own closures, handed in
 * rather than duplicated, because `state.importing` and the save-state flags
 * are shared UI state that must have exactly one owner.
 */

export interface DawprojectServiceOperation {
	readonly task: EditorTaskScope;
	readonly projectToken: EditorProjectToken;
}

export interface DawprojectServiceHelpers {
	beginProjectTask(name: string, expectedProjectId?: string): DawprojectServiceOperation;
	assertOwnership(task: EditorTaskScope, token: EditorProjectToken): void;
	beginImport(task: EditorTaskScope): void;
	finishImport(task: EditorTaskScope): void;
	persistSourceChunks(
		project: NativeProjectDocument,
		sourceId: string,
		chunks: AsyncIterable<readonly Float32Array[]>,
		persistedSourceIds: string[],
		operation: DawprojectServiceOperation,
	): Promise<void>;
	updateNativeProjectProgress(
		progress: NativeProgress,
		prefix: string,
		task?: EditorTaskScope,
		projectToken?: EditorProjectToken,
		range?: Readonly<{ start: number; end: number }>,
		localization?: LocalizedPresentationMessage,
	): void;
	requireProject(): NativeProjectDocument;
}

export interface SaveDawprojectOptions {
	readonly fileName?: string;
}

export interface DawprojectOpenResult extends Readonly<Record<string, unknown>> {
	readonly project: NativeProjectDocument;
	readonly report: unknown;
}

/** One inflated archive entry plus one PCM packet may be resident during import. */
export const DAWPROJECT_IMPORT_WORKING_BYTE_LIMIT = 256 * 1024 * 1024;

export function createDawprojectService(runtime: NativeProjectServiceRuntime, helpers: DawprojectServiceHelpers) {
	return Object.freeze({ openDawproject, saveDawproject });

	async function openDawproject(file: NativeProjectFile): Promise<DawprojectOpenResult | undefined> {
		if (!file || !isDawprojectFileName(String(file.name || ''))) {
			throw new TypeError(runtime.copy.chooseDawprojectFile ?? 'Choose a DAWproject file (.dawproject).');
		}
		if (runtime.editingBlocked()) return undefined;
		const operation = helpers.beginProjectTask('native-project-open');
		const signal = operation.task.signal;
		const assertReady = (): void => { helpers.assertOwnership(operation.task, operation.projectToken); };
		const persistedSourceIds: string[] = [];
		let importedProject: NativeProjectDocument | null = null;
		let activated = false;
		let archive: DawprojectArchive | null = null;
		helpers.beginImport(operation.task);
		setLocalizedStatus(runtime.setStatus, runtime.copy, "importing");
		try {
			archive = await readDawprojectArchive(file, { signal });
			assertReady();
			const document = parseDawprojectDocument(archive.projectXml, archive.metadataXml);
			const references = dawprojectMediaReferences(document)
				.filter((reference) => reference.kind === 'audio' && !reference.external);
			const media = new Map<string, DawprojectDecodedMediaInfo | null>();
			const stagedSourceIds = new Map<string, string>();
			for (const [index, reference] of references.entries()) {
				const entrySize = archive.entrySize(reference.path);
				if (entrySize !== null && entrySize > DAWPROJECT_IMPORT_WORKING_BYTE_LIMIT) {
					throw new RangeError(`DAWproject media ${reference.path} exceeds the import working memory budget.`);
				}
				const blob = await archive.readEntry(reference.path);
				assertReady();
				if (!blob) continue;
				if (blob.size > DAWPROJECT_IMPORT_WORKING_BYTE_LIMIT) {
					throw new RangeError(`DAWproject media ${reference.path} exceeds the import working memory budget.`);
				}
				const wav = await inspectPcmWav(blob, signal);
				let prepared: PreparedStreamedAudioImport | null = null;
				try {
					if (!wav && runtime.prepareDawprojectAudio) {
						assertDawprojectCompressedWorkingBudget(blob.size, DAWPROJECT_IMPORT_WORKING_BYTE_LIMIT, reference.path);
						try { prepared = await runtime.prepareDawprojectAudio(blob, entryBaseName(reference.path), signal); }
						catch (error) {
							if (error instanceof RangeError) throw error;
							assertReady();
						}
					}
					assertReady();
					if (!wav && !prepared) {
						media.set(reference.path, null);
						continue;
					}
					const info = wav ?? prepared!.descriptor;
					admitAudioImportChannelCount(info.channelCount);
					const sourceBytes = info.frameCount * info.channelCount * Float32Array.BYTES_PER_ELEMENT;
					if (!Number.isSafeInteger(sourceBytes)) {
						throw new RangeError(`DAWproject media ${reference.path} exceeds the supported source byte count.`);
					}
					const chunkFrames = Math.min(runtime.sourceChunkFrames, AUDIO_EDITOR_PCM_CHUNK_FRAMES);
					if (wav && blob.size + Math.min(info.frameCount, chunkFrames)
						* (wav.blockAlign + info.channelCount * Float32Array.BYTES_PER_ELEMENT)
						> DAWPROJECT_IMPORT_WORKING_BYTE_LIMIT) {
						throw new RangeError(`DAWproject media ${reference.path} exceeds the import working memory budget.`);
					}
					await runtime.preflightStorage(sourceBytes, 'import');
					assertReady();
					const sourceId = runtime.createStableId('source');
					const staged = stagedProjectSource(sourceId, reference.path, info);
					if (wav) {
						const reader = createWavBlobPcmChunkReader(blob, { descriptor: wav, chunkFrames });
						await helpers.persistSourceChunks(staged, sourceId,
							readWavChunks(reader, signal), persistedSourceIds, operation);
					} else if (!await stageDawprojectCompressedSource(runtime.store, prepared!,
						staged.sources[0] as NativeProjectAudioSource, chunkFrames, signal,
						assertReady, persistedSourceIds)) {
						media.set(reference.path, null);
						continue;
					}
					assertReady();
					stagedSourceIds.set(reference.path, sourceId);
					media.set(reference.path, info);
					helpers.updateNativeProjectProgress(
						{ value: (index + 1) / references.length }, runtime.copy.importing, operation.task, operation.projectToken, undefined, { key: 'importing' },
					);
				} finally { prepared?.dispose(); }
			}
			const plan = buildDawprojectProject(document, {
				fileName: String(file.name), media, stagedSourceIds, createStableId: runtime.createStableId,
			});
			const created = createCurrentAudioEditorProject(plan.project as never);
			// Both interchange readers produce the shared audio document. Apply the
			// product's import adapter before its family-qualified loader sees it.
			importedProject = runtime.adaptAudacityProject
				? await runtime.adaptAudacityProject(created)
				: runtime.loadProject(created).project;
			assertReady();
			const retainedIds = new Set(plan.media.map((binding) => binding.sourceId));
			for (const sourceId of persistedSourceIds) {
				if (!retainedIds.has(sourceId)) await Promise.resolve(runtime.store.deleteSource(sourceId));
			}
			await runtime.switchProject(importedProject, { readOnly: false, save: true });
			activated = true;
			operation.task.assertCurrent();
			runtime.projectGeneration.capture(importedProject.id);
			runtime.state.deliveryReport = plan.report;
			setLocalizedStatus(runtime.setStatus, runtime.copy, 'dawprojectOpened', undefined, 'success', { fallback: 'DAWproject imported.' });
			runtime.publishDocumentSnapshot();
			return Object.freeze({ project: importedProject, report: plan.report });
		} catch (error) {
			const importedProjectIsCurrent = importedProject !== null && runtime.getProject()?.id === importedProject.id;
			if (!activated && !importedProjectIsCurrent) {
				for (const sourceId of persistedSourceIds) {
					await Promise.resolve(runtime.store.deleteSource(sourceId)).catch(() => undefined);
				}
			}
			throw error;
		} finally {
			await archive?.close().catch(() => undefined);
			helpers.finishImport(operation.task);
			operation.task.finish();
		}
	}

	async function saveDawproject(options: SaveDawprojectOptions = {}): Promise<NativeSavedFile & Readonly<{
		fileName: string;
		report: unknown;
	}>> {
		const snapshot = helpers.requireProject();
		if (runtime.hasMissingTimelineSources(snapshot, { audioOnly: true })) {
			throw createLocalizedError(Error, runtime.copy, 'missingSourcesPreventSave');
		}
		const operation = helpers.beginProjectTask('dawproject-export', snapshot.id);
		const assertReady = (): void => { helpers.assertOwnership(operation.task, operation.projectToken); };
		const saving = runtime.copy.dawprojectSaving ?? 'Exporting DAWproject';
		try {
			setLocalizedStatus(runtime.setStatus, runtime.copy, 'dawprojectSaving', undefined, undefined, { fallback: 'Exporting DAWproject' });
			const delivered = resolveDeliveredProject({
				getProject: () => snapshot, state: runtime.state as unknown as Record<string, unknown>,
			});
			if (!delivered) throw createLocalizedError(Error, runtime.copy, 'projectNotFound');
			const embeddableVideoSourceIds = typeof runtime.store.loadMediaAsset === 'function'
				? snapshot.sources.filter((source) => source.kind === 'video').map((source) => source.id)
				: [];
			const exported = createDawprojectExport({
				project: delivered,
				title: snapshot.title,
				application: {
					name: runtime.product?.name ?? 'Soundscaper',
					version: runtime.applicationVersion ?? 'unknown',
				},
				embeddableVideoSourceIds,
			});
			// Publish before the save dialog: a cancelled save keeps the report.
			runtime.state.deliveryReport = exported.report;
			runtime.publishDocumentSnapshot();
			const fileName = options.fileName ? withDawprojectExtension(options.fileName) : exported.fileName;
			const prepared = await runtime.fileService.prepareSave({
				purpose: 'interchange', suggestedName: fileName, mimeType: DAWPROJECT_MIME_TYPE,
				types: [{ description: 'DAWproject', accept: { [DAWPROJECT_MIME_TYPE]: [DAWPROJECT_FILE_EXTENSION] } }],
				useFileSystemAccess: true, signal: operation.task.signal,
			});
			assertReady();
			if (prepared.mode === 'cancelled') throw new DOMException('The file save was cancelled.', 'AbortError');
			const sourceById = new Map(snapshot.sources.map((source) => [source.id, source]));
			let maximumArchiveBytes = new TextEncoder().encode(exported.projectXml).byteLength
				+ new TextEncoder().encode(exported.metadataXml).byteLength
				+ (exported.media.length + 2) * 1024 + 1024 * 1024;
			for (const entry of exported.media) {
				const source = sourceById.get(entry.sourceId);
				if (!source) continue;
				const bytes = entry.kind === 'audio'
					? dawprojectWavByteLength(source as NativeProjectAudioSource)
					: (await mediaBlob(source)).size;
				maximumArchiveBytes += bytes;
				if (!Number.isSafeInteger(maximumArchiveBytes)) {
					throw new RangeError('The DAWproject archive exceeds the supported byte count.');
				}
			}
			assertReady();
			async function* files(): AsyncGenerator<DawprojectArchiveFile> {
				for (const [index, entry] of exported.media.entries()) {
					assertReady();
					const source = sourceById.get(entry.sourceId);
					if (!source) continue;
					yield entry.kind === 'audio'
						? { path: entry.path, stream: dawprojectWavStream(runtime, source as NativeProjectAudioSource, operation.task.signal) }
						: { path: entry.path, blob: await mediaBlob(source) };
					assertReady();
					helpers.updateNativeProjectProgress(
						{ value: (index + 1) / exported.media.length }, saving, operation.task, operation.projectToken, undefined, { key: 'dawprojectSaving', fallback: saving },
					);
				}
			}
			let saved: NativeSavedFile;
			if (prepared.mode === 'stream') {
				try {
					const writable = await prepared.createWritable(maximumArchiveBytes);
					await writeDawprojectArchiveToStream(
						{ projectXml: exported.projectXml, metadataXml: exported.metadataXml, files: files() },
						writable, { signal: operation.task.signal },
					);
					assertReady();
					saved = await prepared.commit();
				} catch (error) {
					await prepared.abort(error);
					throw error;
				}
			} else {
				if (maximumArchiveBytes > DAWPROJECT_BLOB_EXPORT_BYTE_LIMIT) {
					throw new RangeError('DAWproject export exceeds the browser download memory budget. Choose a file streaming destination.');
				}
				await runtime.preflightStorage(maximumArchiveBytes, 'export');
				assertReady();
				const blob = await writeDawprojectArchive(
					{ projectXml: exported.projectXml, metadataXml: exported.metadataXml, files: files() },
					{ signal: operation.task.signal },
				);
				assertReady();
				saved = await runtime.fileService.saveFile({
					purpose: 'interchange', suggestedName: fileName, mimeType: DAWPROJECT_MIME_TYPE,
					blob, target: prepared.target, useFileSystemAccess: false,
					signal: operation.task.signal,
				});
			}
			if (saved.cancelled) throw new DOMException('The file save was cancelled.', 'AbortError');
			assertReady();
			setLocalizedStatus(runtime.setStatus, runtime.copy, 'dawprojectSaved', undefined, 'success', { fallback: 'DAWproject exported.' });
			runtime.publishDocumentSnapshot();
			return Object.freeze({ ...saved, fileName: exported.fileName, report: exported.report });
		} finally {
			operation.task.finish();
		}
	}

	async function mediaBlob(source: NativeProjectDocument['sources'][number]): Promise<BlobLike> {
		const unavailable = (): Error => createLocalizedError(Error, runtime.copy, 'sourcePcmUnavailable', { source: source.name || source.id });
		const blob = await runtime.store.loadMediaAsset?.(source.storageKey ?? source.id);
		if (!blob) throw unavailable();
		return blob;
	}
}

async function inspectPcmWav(blob: Blob, signal: AbortSignal): Promise<WavPcmDescriptor | null> {
	const signature = String.fromCharCode(...new Uint8Array(await blob.slice(0, 4).arrayBuffer()));
	if (!['RIFF', 'RF64', 'BW64'].includes(signature)) return null;
	try {
		return await inspectWavBlobPcm(blob, { signal }) as WavPcmDescriptor;
	} catch (error) {
		if (signal.aborted) throw error;
		// Compressed or unusual WAV formats still belong to the codec fallback.
		return null;
	}
}

function stagedProjectSource(id: string, path: string, info: DawprojectDecodedMediaInfo): NativeProjectDocument {
	return {
		id: `staging-${id}`,
		title: 'DAWproject staging',
		schemaVersion: 17,
		sources: [{
			kind: 'audio', id, storageKey: id, name: entryBaseName(path), mimeType: dawprojectImportedAudioMimeType(path),
			frameCount: info.frameCount, channelCount: info.channelCount, sampleRate: info.sampleRate,
		}],
		clips: [],
	};
}

async function* readWavChunks(reader: WavBlobPcmChunkReader, signal: AbortSignal): AsyncGenerator<readonly Float32Array[]> {
	for (let index = 0; index < reader.chunkCount; index += 1) {
		signal.throwIfAborted();
		yield (await reader.readChunk(index, { signal })).channels;
	}
}

function withDawprojectExtension(fileName: string): string {
	const trimmed = String(fileName).trim() || 'project';
	return isDawprojectFileName(trimmed) ? trimmed : `${trimmed}${DAWPROJECT_FILE_EXTENSION}`;
}
