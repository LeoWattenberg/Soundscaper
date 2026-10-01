/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAudioMediaKind } from '../../audio-media-kind.ts'; import { createLocalizedError, publishLocalizedStatus, setLocalizedStatus, type LocalizedPresentationMessage } from '../../../i18n/presentation-message.ts';

import { isProjectFileName } from '../../../project-file-extensions.ts';
import { createDeferredDawprojectService } from '../import/deferred-dawproject-service.ts';
import { createDeferredSesxService } from '../import/deferred-sesx-service.ts';
import {
	EDITOR_PROJECT_TASK_SCOPE,
	type EditorProjectToken,
	type EditorTaskOptions,
	type EditorTaskScope,
} from '../shared/lifecycle.ts';

/**
 * A native save belongs to the project that started it: switching away must
 * cancel it rather than let it write the old document under the new project.
 */
const PROJECT_SCOPED_TASK: EditorTaskOptions = Object.freeze({ scope: EDITOR_PROJECT_TASK_SCOPE });
import { createNativeProjectOwnership, type ProjectTask } from './internal/native-project/native-project-ownership.ts';
import { nativeProjectProgressLocalization, nativeProjectProgressMessage, publishAup4OpenStatus } from './internal/native-project/native-project-status.ts';
import {
	bufferedNativeSourceChunks,
	persistNativeProjectSource,
} from './internal/native-project/native-project-source-persistence.ts';
import {
	beginNativeScapeSave,
	type NativeRetainedScapeArchive,
	publishNativeScape,
	saveNativeScapeArchiveCopy,
} from './internal/native-project/native-scape-save.ts';
import { createNativeAudacityProjectSave } from './internal/native-project/native-audacity-project-save.ts';
import type {
	Aup4DecodedSource,
	Aup4Environment,
	Aup4PortableOptions,
	NativeAup4Client,
	NativeCompatibilityReport,
	NativeProgress,
	NativeProjectAudioSource,
	NativeProjectDocument, NativeProjectFile, NativeScapeProjectFile,
	NativeProjectServiceRuntime,
	NativeSavedFile,
	NativeScapeManifest,
	OpenScapeOptions,
	SaveScapeOptions,
	ScapeImportResult,
} from './native-project-types.ts';

export type { NativeProjectServiceRuntime, OpenScapeOptions, SaveAup3Options, SaveAup4Options, SaveScapeOptions } from './native-project-types.ts';
const READ_ONLY_AUP4_ISSUES = new Set(['EDITABLE_LIMIT_EXCEEDED']);

/**
 * Owns native project I/O, temporary AUP4 database cleanup, and the UI state
 * published by those operations. The controller supplies file-format ports so
 * this orchestration stays independent of archive and worker implementation.
 */
export function createNativeProjectService(runtime: NativeProjectServiceRuntime) {
	let client = runtime.initialAup4Client ?? null;
	let environment: Aup4Environment | null = null;
	let initialization: Promise<Aup4Environment> | null = null;
	let clientDisposed = false;
	let futureScapeArchive: NativeRetainedScapeArchive | null = null;
	const {
		assertNotDisposed, assertOwnership, beginImport, beginProjectTask, beginSave,
		failSave, finishImport, finishSave, markDisposed,
		requireOwnedProject, requireProject,
	} = createNativeProjectOwnership(runtime);
	const dawproject = createDeferredDawprojectService(runtime, { beginProjectTask, assertOwnership, beginImport, finishImport, persistSourceChunks, updateNativeProjectProgress, requireProject });
	const sesx = createDeferredSesxService(runtime, { beginProjectTask, assertOwnership, beginImport, finishImport, persistSourceChunks, updateNativeProjectProgress, requireProject });
	const audacitySave = createNativeAudacityProjectSave(runtime, {
		assertOwnership, beginProjectTask, beginSave, failSave, finishSave,
		getClient: getAup4Client,
		getEnvironment: () => environment,
		rememberCompatibilityReport: rememberAup4CompatibilityReport,
		requireOwnedProject, requireProject,
		updateProgress: (progress, prefix, task, projectToken, localization) => {
			updateNativeProjectProgress(progress, prefix, task, projectToken, undefined, localization);
		},
	});

	return Object.freeze({
		dismissAup4CompatibilitySummary,
		dispose,
		getAup4Client,
		nativeProjectProgressMessage,
		openAudacityProject,
		openAup4, openDawproject: dawproject.openDawproject, saveDawproject: dawproject.saveDawproject, openSesx: sesx.openSesx,
		openScape,
		rememberAup4CompatibilityReport,
		saveAup3: audacitySave.saveAup3,
		saveAup4: audacitySave.saveAup4,
		saveScape,
		updateNativeProjectProgress,
	});

	async function getAup4Client(): Promise<NativeAup4Client> {
		assertNotDisposed();
		runtime.lifetime.assertActive();
		client ??= runtime.createAup4Client(runtime.aup4Options ?? {});
		if (environment) return client;
		initialization ??= Promise.resolve(client.initialize());
		try {
			const initialized = await initialization;
			assertNotDisposed();
			runtime.lifetime.assertActive();
			environment = initialized;
			return client;
		} catch (error) {
			initialization = null;
			throw error;
		}
	}

	async function dispose(): Promise<void> {
		if (!markDisposed()) return;
		const activeClient = client;
		client = null;
		environment = null;
		initialization = null;
		if (!activeClient || clientDisposed) return;
		clientDisposed = true;
		await Promise.resolve(activeClient.dispose?.());
	}

	async function openScape(
		file: NativeScapeProjectFile,
		options: OpenScapeOptions = {},
	): Promise<ScapeImportResult | null> {
		if (!file || (file instanceof Blob && 'name' in file && !isProjectFileName(String(file.name || '')))) {
			throw new TypeError('Choose a Scape project file.');
		}
		if (runtime.editingBlocked()) return null;
		const operation = beginProjectTask('native-project-open');
		const signal = options.signal ? AbortSignal.any([operation.task.signal, options.signal]) : operation.task.signal;
		try {
			signal.throwIfAborted();
			beginImport(operation.task);
			if (options.collision === 'replace' && runtime.getProject() && !runtime.state.readOnly) {
				await runtime.flushProject();
				assertOwnership(operation.task, operation.projectToken);
			}
			const imported = await runtime.importScapeProject(file, runtime.store, {
				collision: options.collision || 'copy', acquireReplaceProjectWriteAuthority: runtime.acquireReplaceProjectWriteAuthority,
				estimateStorageForPreflight: (bytes, operation) => runtime.estimateStorageForPreflight(bytes, operation, signal), signal,
			});
			if (imported.publicationCommitted === true) {
				// Publication is durable now. Adopt it despite a late cancellation, but
				// never activate it over a different project opened in the meantime.
				runtime.projectGeneration.assertCurrent(operation.projectToken);
			} else {
				signal.throwIfAborted();
				assertOwnership(operation.task, operation.projectToken);
			}
			futureScapeArchive = imported.readOnly && file instanceof Blob
				? { projectId: imported.project.id, archive: file, manifest: imported.manifest } : null;
			await runtime.switchProject(imported.project, {
				readOnly: imported.readOnly,
				readOnlyReason: imported.readOnly ? runtime.copy.futureProjectReadOnly : null,
				skipFlush: imported.collision === 'replace',
				adoptSessionRevision: imported.collision === 'replace',
				replaceSessionHistory: imported.collision === 'replace',
				preserveScapeOpenRequest: true,
			});
			if (imported.publicationCommitted !== true) {
				signal.throwIfAborted();
				operation.task.assertCurrent();
			}
			runtime.projectGeneration.capture(imported.project.id);
			setLocalizedStatus(runtime.setStatus, runtime.copy, runtime.state.readOnly ? 'projectReadOnly' : 'projectSaved', undefined, runtime.state.readOnly ? 'error' : 'success');
			return imported;
		} finally {
			finishImport(operation.task);
			operation.task.finish();
		}
	}

	async function saveScape(options: SaveScapeOptions = {}): Promise<(NativeSavedFile & {
		readonly manifest: NativeScapeManifest;
	}) | Readonly<{ cancelled: true }>> {
		const projectAtStart = requireProject();
		if (runtime.state.readOnly && !options.saveCopy) throw createLocalizedError(Error, runtime.copy, 'projectReadOnly');
		if (runtime.state.readOnly && futureScapeArchive?.projectId === projectAtStart.id) {
			const operation = beginProjectTask('native-project-save', projectAtStart.id, PROJECT_SCOPED_TASK);
			try {
				return await saveNativeScapeArchiveCopy(runtime, {
					assertReady: () => assertOwnership(operation.task, operation.projectToken),
					fallbackFileName: projectAtStart.title, options, retained: futureScapeArchive, signal: operation.task.signal,
				});
			} finally { operation.task.finish(); }
		}
		if (runtime.hasMissingTimelineSources(projectAtStart)) throw createLocalizedError(Error, runtime.copy, 'missingSourcesPreventSave');
		const operation = beginProjectTask('native-project-save', projectAtStart.id, PROJECT_SCOPED_TASK);
		try {
			const { fileName, prepared } = await beginNativeScapeSave(runtime, {
				fallbackFileName: projectAtStart.title, options, signal: operation.task.signal,
			});
			if (prepared.mode === 'cancelled') return { cancelled: true };
			assertOwnership(operation.task, operation.projectToken);
			await runtime.flushProject({ prepareCurrentSnapshot: true, preparationPurpose: 'scape-save' });
			assertOwnership(operation.task, operation.projectToken);
			const snapshot = requireOwnedProject(projectAtStart.id);
			beginSave(operation.task, operation.projectToken);
			const { exported, saved } = await publishNativeScape(runtime, {
				assertReadyToCommit: () => assertOwnership(operation.task, operation.projectToken),
				fileName, prepared, project: snapshot, signal: operation.task.signal,
			});
			if (finishSave(operation.task, operation.projectToken, 'saved')) {
				setLocalizedStatus(runtime.setStatus, runtime.copy, "projectSaved", undefined, 'success');
				runtime.publishDocumentSnapshot();
			}
			return { ...saved, manifest: exported.manifest };
		} catch (error) {
			failSave(operation.task, operation.projectToken);
			throw error;
		} finally {
			operation.task.finish();
		}
	}

	async function openAudacityProject(file: NativeProjectFile): Promise<Readonly<Record<string, unknown>> | undefined> {
		if (!file || !/\.aup[34]$/i.test(String(file.name || ''))) {
			throw new TypeError('Choose an Audacity project file (.aup3 or .aup4).');
		}
		if (runtime.editingBlocked()) return undefined;
		const operation = beginProjectTask('native-project-open');
		const sourceGeneration = /\.aup3$/i.test(file.name) ? 'aup3' : 'aup4';
		const nativeId = sanitizeNativeId(runtime.createStableId('audacity-project'));
		const persistedSourceIds: string[] = [];
		let importedProject: NativeProjectDocument | null = null, activated = false;
		beginImport(operation.task);
		setLocalizedStatus(runtime.setStatus, runtime.copy, "aup4Validating");
		try {
			const activeClient = await getAup4Client();
			assertOwnership(operation.task, operation.projectToken);
			const storage = await runtime.store.estimateStorage();
			assertOwnership(operation.task, operation.projectToken);
			const opened = await activeClient.openFile(nativeId, file, { ...portableOptions(file.size, storage, (progress) => {
				updateNativeProjectProgress(progress, runtime.copy.importing, operation.task,
					operation.projectToken, { start: 0, end: 0.3 }, { key: 'importing' });
			}), signal: operation.task.signal });
			assertOwnership(operation.task, operation.projectToken);
			const streaming = Boolean(activeClient.planImport && activeClient.readSourceChunks);
			const decode = streaming ? activeClient.planImport! : activeClient.decode;
			const decoded = await decode.call(activeClient, nativeId, {
				title: file.name, signal: operation.task.signal,
				onProgress: (progress) => {
					updateNativeProjectProgress(progress, runtime.copy.importing, operation.task,
						operation.projectToken, { start: 0.3, end: 1 }, { key: 'importing' });
				},
			});
			assertOwnership(operation.task, operation.projectToken);
			importedProject = runtime.adaptAudacityProject
				? await runtime.adaptAudacityProject(decoded.project)
				: runtime.loadProject(decoded.project).project;
			const decodedBytes = streaming
				? importedProject.sources.filter((source) => isAudioMediaKind(source.kind)).reduce(
					(total, source) => total + runtime.sourcePcmBytes(source as NativeProjectAudioSource), 0)
				: decoded.sources.reduce((total, source) => total + source.channels.reduce(
				(channelTotal, channel) => channelTotal + channel.byteLength,
				0,
			), 0);
			await runtime.preflightStorage(decodedBytes, 'import');
			assertOwnership(operation.task, operation.projectToken);
			if (streaming) {
				let completedBytes = 0;
				for (const source of importedProject.sources.filter((item) => isAudioMediaKind(item.kind))) {
					const chunks = activeClient.readSourceChunks!(nativeId, source.id, { signal: operation.task.signal });
					await persistNativeProjectSource(runtime, importedProject, source.id, chunks, persistedSourceIds,
						() => assertOwnership(operation.task, operation.projectToken),
						(bytes) => {
							completedBytes += bytes;
							updateNativeProjectProgress({ value: decodedBytes ? completedBytes / decodedBytes : 1 },
								runtime.copy.importing, operation.task, operation.projectToken, { start: 0.3, end: 1 }, { key: 'importing' });
						});
				}
			} else for (const sourceAudio of decoded.sources) {
				await persistDecodedSource(importedProject, sourceAudio, persistedSourceIds, operation);
			}
			const compatibilityIssues = opened.validation?.issues || decoded.validation?.issues || [];
			const readOnlyIssue = compatibilityIssues.find((issue) => READ_ONLY_AUP4_ISSUES.has(issue.code || ''));
			await runtime.switchProject(importedProject, {
				readOnly: opened.readOnly,
				readOnlyReason: readOnlyIssue?.message,
				save: !opened.readOnly,
			});
			activated = true;
			operation.task.assertCurrent();
			runtime.projectGeneration.capture(importedProject.id);
			const rawCompatibilityValue = decoded.compatibilityReport
				|| decoded.validation?.compatibilityReport
				|| opened.validation?.compatibilityReport;
			const rawCompatibilityReport = rawCompatibilityValue && typeof rawCompatibilityValue === 'object'
				? rawCompatibilityValue as Readonly<Record<string, unknown>>
				: {};
			const compatibilityReport = rememberAup4CompatibilityReport(
				{ ...rawCompatibilityReport, format: 'audacity-project', sourceGeneration },
				'open',
				importedProject.id,
			);
			const validationWarnings = compatibilityIssues
				.filter((issue) => issue.level === 'warning')
				.map((issue) => issue.message || '');
			const allWarnings = [...validationWarnings, ...(decoded.warnings || [])].filter(Boolean);
			publishAup4OpenStatus(runtime, opened.readOnly, readOnlyIssue, allWarnings);
			return Object.freeze({
				project: importedProject,
				validation: decoded.validation,
				warnings: decoded.warnings || [],
				compatibilityReport,
			});
		} catch (error) {
			const importedProjectIsCurrent = importedProject !== null && runtime.getProject()?.id === importedProject.id;
			if (!activated && !importedProjectIsCurrent) await deleteSources(
				(sourceId) => runtime.store.deleteSource(sourceId), persistedSourceIds,
			);
			throw error;
		} finally {
			await closeNativeProject(client, nativeId);
			finishImport(operation.task);
			operation.task.finish();
		}
	}

	/** Compatibility alias for integrations that opened only AUP4. */
	async function openAup4(file: NativeProjectFile): Promise<Readonly<Record<string, unknown>> | undefined> { return openAudacityProject(file); }

	async function persistDecodedSource(
		project: NativeProjectDocument,
		sourceAudio: Aup4DecodedSource,
		persistedSourceIds: string[],
		operation: ProjectTask,
	): Promise<void> {
		await persistSourceChunks(project, sourceAudio.sourceId,
			bufferedNativeSourceChunks(sourceAudio.channels, runtime.sourceChunkFrames), persistedSourceIds, operation);
	}

	async function persistSourceChunks(
		project: NativeProjectDocument,
		sourceId: string,
		chunks: AsyncIterable<readonly Float32Array[]>,
		persistedSourceIds: string[],
		operation: ProjectTask,
	): Promise<void> {
		await persistNativeProjectSource(runtime, project, sourceId, chunks, persistedSourceIds,
			() => assertOwnership(operation.task, operation.projectToken));
	}

	function rememberAup4CompatibilityReport(
		report: unknown,
		direction: 'open' | 'save',
		expectedProjectId?: string,
	): NativeCompatibilityReport {
		const normalized = runtime.normalizeCompatibilityReport(report, direction);
		const activeProject = runtime.getProject();
		if (activeProject
			&& (!expectedProjectId || activeProject.id === expectedProjectId)
			&& runtime.sessionTab(activeProject.id)) {
			runtime.updateProjectMetadata(activeProject.id, {
				aup4CompatibilityReport: normalized,
				aup4CompatibilityReportDismissed: false,
			});
			runtime.publishDocumentSnapshot();
		}
		return normalized;
	}

	function dismissAup4CompatibilitySummary(): boolean {
		const activeProject = runtime.getProject();
		if (!activeProject) return false;
		const tab = runtime.sessionTab(activeProject.id);
		const metadata = tab?.metadata || {};
		if (!tab || !metadata.aup4CompatibilityReport || metadata.aup4CompatibilityReportDismissed) return false;
		runtime.updateProjectMetadata(activeProject.id, { aup4CompatibilityReportDismissed: true });
		runtime.publishDocumentSnapshot();
		return true;
	}

	function updateNativeProjectProgress(
		progress: NativeProgress,
		prefix: string,
		task?: EditorTaskScope,
		projectToken?: EditorProjectToken,
		range: Readonly<{ start: number; end: number }> = { start: 0, end: 1 },
		localization?: LocalizedPresentationMessage,
	): void {
		if (task && projectToken) assertOwnership(task, projectToken);
		const operation = localization ? { ...localization, fallback: localization.fallback ?? prefix } : prefix;
		runtime.taskProgress?.setActivePhase(prefix, { ...range, value: progress.value }, typeof operation === 'object' ? operation : undefined);
		publishLocalizedStatus(runtime.setStatus, nativeProjectProgressMessage(progress, prefix), nativeProjectProgressLocalization(progress, operation));
	}

	function portableOptions(
		workingBytes: number,
		storage: Awaited<ReturnType<NativeProjectServiceRuntime['store']['estimateStorage']>>,
		onProgress: (progress: NativeProgress) => void,
	): Aup4PortableOptions {
		return {
			mobile: runtime.state.mobile,
			opfs: environment?.opfs,
			quota: storage.quota ?? undefined,
			usage: storage.usage ?? undefined,
			workingBytes,
			onProgress,
		};
	}
}

function sanitizeNativeId(value: string): string {
	return value.replace(/[^a-z0-9_-]/gi, '-');
}

async function closeNativeProject(client: NativeAup4Client | null, nativeId: string): Promise<void> {
	if (!client) return;
	try {
		if (typeof client.delete === 'function') await client.delete(nativeId);
		else await client.close?.(nativeId);
	} catch {
		// Native staging cleanup is best-effort and must not mask the operation.
	}
}

async function deleteSources(
	deleteSource: (sourceId: string) => PromiseLike<unknown> | unknown,
	sourceIds: readonly string[],
): Promise<void> {
	for (const sourceId of sourceIds) {
		await Promise.resolve(deleteSource(sourceId)).catch(() => undefined);
	}
}
