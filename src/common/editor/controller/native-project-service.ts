/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	EditorDisposedError,
	type EditorProjectToken,
	type EditorTaskScope,
} from './lifecycle.ts';
import type {
	Aup4CompatibilityIssue,
	Aup4DecodedSource,
	Aup4Environment,
	Aup4PortableOptions,
	Aup4SnapshotSource,
	NativeAup4Client,
	NativeCompatibilityReport,
	NativeProgress,
	NativeProjectAudioSource,
	NativeProjectDocument,
	NativeProjectFile,
	NativeProjectServiceRuntime,
	NativeSavedFile,
	OpenScapeOptions,
	SaveAup4Options,
	SaveScapeOptions,
	ScapeImportResult,
} from './native-project-types.ts';

export type {
	NativeProjectServiceRuntime,
	OpenScapeOptions,
	SaveAup4Options,
	SaveScapeOptions,
} from './native-project-types.ts';

const READ_ONLY_AUP4_ISSUES = new Set([
	'NEWER_DATABASE',
	'NEWER_XML',
	'EDITABLE_LIMIT_EXCEEDED',
	'MISSING_LOCAL_AUDIO',
]);

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
	let disposed = false;
	let importOwner: EditorTaskScope | null = null;
	let saveOwner: EditorTaskScope | null = null;

	return Object.freeze({
		dismissAup4CompatibilitySummary,
		dispose,
		getAup4Client,
		nativeProjectProgressMessage,
		openAup4,
		openScape,
		rememberAup4CompatibilityReport,
		saveAup4,
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
		if (disposed) return;
		disposed = true;
		const activeClient = client;
		client = null;
		environment = null;
		initialization = null;
		if (!activeClient || clientDisposed) return;
		clientDisposed = true;
		await Promise.resolve(activeClient.dispose?.());
	}

	async function openScape(
		file: NativeProjectFile,
		options: OpenScapeOptions = {},
	): Promise<ScapeImportResult | null> {
		if (!file || !/\.scape$/i.test(String(file.name || ''))) {
			throw new TypeError('Choose a .scape project file.');
		}
		if (runtime.editingBlocked()) return null;
		const operation = beginProjectTask('native-project-open');
		let publicationToken = operation.projectToken;
		beginImport(operation.task);
		try {
			const imported = await runtime.importScapeProject(file, runtime.store, {
				collision: options.collision || 'copy',
			});
			assertOwnership(operation.task, operation.projectToken);
			await runtime.switchProject(imported.project, {
				readOnly: imported.readOnly,
				readOnlyReason: imported.readOnly ? runtime.copy.futureProjectReadOnly : null,
				skipFlush: false,
			});
			operation.task.assertCurrent();
			publicationToken = runtime.projectGeneration.capture(imported.project.id);
			runtime.setStatus(runtime.copy.projectSaved, 'success');
			return imported;
		} finally {
			finishImport(operation.task, publicationToken);
			operation.task.finish();
		}
	}

	async function saveScape(options: SaveScapeOptions = {}): Promise<NativeSavedFile & {
		readonly manifest: Readonly<Record<string, unknown>>;
	}> {
		const projectAtStart = requireProject();
		if (runtime.state.readOnly && !options.saveCopy) throw new Error(runtime.copy.projectReadOnly);
		if (runtime.hasMissingTimelineSources(projectAtStart)) throw new Error(runtime.copy.missingSourcesPreventSave);
		const operation = beginProjectTask('native-project-save', projectAtStart.id);
		try {
			await runtime.flushProject();
			assertOwnership(operation.task, operation.projectToken);
			const snapshot = requireOwnedProject(projectAtStart.id);
			beginSave(operation.task, operation.projectToken);
			const exported = await runtime.exportScapeProject(snapshot, runtime.store);
			assertOwnership(operation.task, operation.projectToken);
			const saved = await runtime.fileService.saveFile({
				purpose: 'project',
				blob: exported.blob,
				suggestedName: runtime.ensureScapeFileName(options.fileName || snapshot.title),
				mimeType: runtime.scapeMimeType,
				target: options.saveTarget,
				useFileSystemAccess: options.useFileSystemAccess !== false,
			});
			assertOwnership(operation.task, operation.projectToken);
			finishSave(operation.task, operation.projectToken, 'saved');
			runtime.setStatus(runtime.copy.projectSaved, 'success');
			runtime.publishDocumentSnapshot();
			return { ...saved, manifest: exported.manifest };
		} catch (error) {
			failSave(operation.task, operation.projectToken);
			throw error;
		} finally {
			operation.task.finish();
		}
	}

	async function openAup4(file: NativeProjectFile): Promise<Readonly<Record<string, unknown>> | undefined> {
		if (!file || !/\.aup4$/i.test(String(file.name || ''))) throw new TypeError(runtime.copy.chooseAup4File);
		if (runtime.editingBlocked()) return undefined;
		const operation = beginProjectTask('native-project-open');
		let publicationToken = operation.projectToken;
		const nativeId = sanitizeNativeId(runtime.createStableId('aup4'));
		const persistedSourceIds: string[] = [];
		let activated = false;
		beginImport(operation.task);
		runtime.setStatus(runtime.copy.aup4Validating);
		try {
			const activeClient = await getAup4Client();
			assertOwnership(operation.task, operation.projectToken);
			const storage = await runtime.store.estimateStorage();
			assertOwnership(operation.task, operation.projectToken);
			const opened = await activeClient.openFile(nativeId, file, portableOptions(file.size, storage, (progress) => {
				updateNativeProjectProgress(progress, runtime.copy.importing, operation.task, operation.projectToken);
			}));
			assertOwnership(operation.task, operation.projectToken);
			const decoded = await activeClient.decode(nativeId, {
				title: file.name,
				onProgress: (progress) => {
					updateNativeProjectProgress(progress, runtime.copy.importing, operation.task, operation.projectToken);
				},
			});
			assertOwnership(operation.task, operation.projectToken);
			const importedProject = runtime.migrateProject(decoded.project).project;
			const decodedBytes = decoded.sources.reduce((total, source) => total + source.channels.reduce(
				(channelTotal, channel) => channelTotal + channel.byteLength,
				0,
			), 0);
			await runtime.preflightStorage(decodedBytes, 'import');
			assertOwnership(operation.task, operation.projectToken);
			for (const sourceAudio of decoded.sources) {
				await persistDecodedSource(importedProject, sourceAudio, persistedSourceIds, operation);
			}
			const compatibilityIssues = opened.validation?.issues || decoded.validation?.issues || [];
			const readOnlyIssue = compatibilityIssues.find((issue) => READ_ONLY_AUP4_ISSUES.has(issue.code || ''));
			await runtime.switchProject(importedProject, {
				readOnly: opened.readOnly,
				readOnlyReason: readOnlyIssue?.message,
				save: !opened.readOnly,
			});
			operation.task.assertCurrent();
			publicationToken = runtime.projectGeneration.capture(importedProject.id);
			activated = true;
			const compatibilityReport = rememberAup4CompatibilityReport(
				decoded.compatibilityReport
					|| decoded.validation?.compatibilityReport
					|| opened.validation?.compatibilityReport,
				'open',
				importedProject.id,
			);
			const validationWarnings = compatibilityIssues
				.filter((issue) => issue.level === 'warning')
				.map((issue) => issue.message || '');
			const allWarnings = [...validationWarnings, ...(decoded.warnings || [])].filter(Boolean);
			publishAup4OpenStatus(opened.readOnly, readOnlyIssue, allWarnings);
			return Object.freeze({
				project: importedProject,
				validation: decoded.validation,
				warnings: decoded.warnings || [],
				compatibilityReport,
			});
		} catch (error) {
			if (!activated) await deleteSources(
				(sourceId) => runtime.store.deleteSource(sourceId),
				persistedSourceIds,
			);
			throw error;
		} finally {
			await closeNativeProject(client, nativeId);
			finishImport(operation.task, publicationToken);
			operation.task.finish();
		}
	}

	async function saveAup4(options: SaveAup4Options = {}): Promise<NativeSavedFile | Readonly<{
		cancelled: true;
	}>> {
		let snapshot = requireProject();
		if (snapshot.schemaVersion < 2) throw new Error(runtime.copy.aup4OnlyV2);
		if (runtime.hasMissingTimelineSources(snapshot, { audioOnly: true })) {
			throw new Error(runtime.copy.missingSourcesPreventSave);
		}
		if (runtime.reportHasMissingPcm(runtime.sessionTab(snapshot.id)?.metadata?.aup4CompatibilityReport)) {
			throw new Error(runtime.copy.missingSourcesPreventSave);
		}
		if (runtime.state.readOnly && !options.saveCopy) throw new Error(runtime.copy.projectReadOnly);
		const operation = beginProjectTask('native-project-save', snapshot.id);
		let fileHandle = options.fileHandle;
		let saveTarget = options.saveTarget;
		let activeClient: NativeAup4Client | null = null;
		let nativeId: string | null = null;
		let nativeCreated = false;
		try {
			if (runtime.fileService.isDesktop && saveTarget === undefined) {
				try {
					saveTarget = await runtime.fileService.chooseSaveTarget({
						purpose: 'aup4',
						suggestedName: runtime.ensureAup4FileName(options.fileName || snapshot.title),
						mimeType: 'application/x-audacity-project',
					});
				} catch (error) {
					if (isAbortError(error)) return { cancelled: true };
					throw error;
				}
				assertOwnership(operation.task, operation.projectToken);
				if (!saveTarget) return { cancelled: true };
			} else if (!fileHandle && options.useFileSystemAccess !== false) {
				try {
					fileHandle = await runtime.requestAup4FileHandle({ fileName: options.fileName || snapshot.title });
				} catch (error) {
					if (isAbortError(error)) return { cancelled: true };
					throw error;
				}
				assertOwnership(operation.task, operation.projectToken);
			}
			snapshot = requireOwnedProject(snapshot.id);
			activeClient = await getAup4Client();
			assertOwnership(operation.task, operation.projectToken);
			nativeId = sanitizeNativeId(runtime.createStableId('aup4-export'));
			const referencedSources = snapshot.sources.filter((source): source is NativeProjectAudioSource => (
				source.kind !== 'video'
				&& snapshot.clips.some((clip) => clip.kind !== 'video' && clip.sourceId === source.id)
			));
			const sourceBytes = referencedSources.reduce((total, source) => total + runtime.sourcePcmBytes(source), 0);
			const workingBytes = referencedSources.reduce((maximum, source) => (
				Math.max(maximum, runtime.sourcePcmBytes(source))
			), 0);
			await runtime.preflightStorage(sourceBytes, 'export');
			assertOwnership(operation.task, operation.projectToken);
			const storage = await runtime.store.estimateStorage();
			assertOwnership(operation.task, operation.projectToken);
			const progress = (value: NativeProgress) => {
				updateNativeProjectProgress(value, runtime.copy.aup4Saving, operation.task, operation.projectToken);
			};
			const portable = portableOptions(workingBytes, storage, progress);
			beginSave(operation.task, operation.projectToken);
			await activeClient.create(nativeId);
			nativeCreated = true;
			assertOwnership(operation.task, operation.projectToken);
			const written = await activeClient.writeSnapshot(
				nativeId,
				snapshot,
				readAup4SourceAudio(referencedSources, operation),
				portable,
			);
			assertOwnership(operation.task, operation.projectToken);
			await activeClient.commit(nativeId);
			assertOwnership(operation.task, operation.projectToken);
			const result = await activeClient.export(nativeId, portable);
			assertOwnership(operation.task, operation.projectToken);
			const saved = await runtime.saveAup4Result(result, {
				fileName: options.fileName || snapshot.title,
				fileHandle,
				fileService: runtime.fileService,
				saveTarget,
			});
			assertOwnership(operation.task, operation.projectToken);
			const validation = result.validation || await activeClient.inspect(nativeId);
			assertOwnership(operation.task, operation.projectToken);
			const compatibilityReport = rememberAup4CompatibilityReport(
				written.compatibilityReport || result.compatibilityReport || validation.compatibilityReport,
				'save',
				snapshot.id,
			);
			finishSave(operation.task, operation.projectToken, 'saved');
			runtime.setStatus(runtime.copy.aup4Saved, 'success');
			runtime.publishDocumentSnapshot();
			return { ...saved, validation, compatibilityReport };
		} catch (error) {
			failSave(operation.task, operation.projectToken);
			throw error;
		} finally {
			if (nativeCreated && nativeId) await closeNativeProject(activeClient, nativeId);
			operation.task.finish();
		}
	}

	async function persistDecodedSource(
		project: NativeProjectDocument,
		sourceAudio: Aup4DecodedSource,
		persistedSourceIds: string[],
		operation: ProjectTask,
	): Promise<void> {
		const source = project.sources.find((candidate): candidate is NativeProjectAudioSource => (
			candidate.kind !== 'video' && candidate.id === sourceAudio.sourceId
		));
		if (!source) return;
		const writer = await runtime.store.beginSourceWrite(source.id, {
			name: source.name,
			mimeType: source.mimeType,
			sampleRate: source.sampleRate,
			channelCount: source.channelCount,
			chunkFrames: runtime.sourceChunkFrames,
		});
		assertOwnership(operation.task, operation.projectToken);
		try {
			for (let offset = 0; offset < source.frameCount; offset += runtime.sourceChunkFrames) {
				const end = Math.min(source.frameCount, offset + runtime.sourceChunkFrames);
				await writer.write(sourceAudio.channels.map((channel) => channel.subarray(offset, end)));
				assertOwnership(operation.task, operation.projectToken);
			}
			await writer.commit({ sampleRate: source.sampleRate, channelCount: source.channelCount });
			persistedSourceIds.push(source.id);
			assertOwnership(operation.task, operation.projectToken);
		} catch (error) {
			await Promise.resolve(writer.abort()).catch(() => undefined);
			throw error;
		}
	}

	async function* readAup4SourceAudio(
		sources: readonly NativeProjectAudioSource[],
		operation: ProjectTask,
	): AsyncGenerator<Aup4SnapshotSource> {
		for (const source of sources) {
			assertOwnership(operation.task, operation.projectToken);
			const buffer = runtime.sourceBuffers.get(source.id);
			const channels = buffer
				? Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel))
				: await runtime.loadStoredSourceChannels(runtime.store, source);
			assertOwnership(operation.task, operation.projectToken);
			if (!channels?.length) {
				throw new Error(runtime.copy.sourcePcmUnavailable.replace('{source}', source.name || source.id));
			}
			yield { sourceId: source.id, sampleRate: source.sampleRate, channels };
		}
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
	): void {
		if (task && projectToken) assertOwnership(task, projectToken);
		runtime.setStatus(nativeProjectProgressMessage(progress, prefix));
	}

	function nativeProjectProgressMessage(progress: NativeProgress, prefix: string): string {
		const percentage = Math.round(Math.max(0, Math.min(1, Number(progress?.value) || 0)) * 100);
		return `${prefix} ${percentage}%`;
	}

	function publishAup4OpenStatus(
		readOnly: boolean,
		readOnlyIssue: Aup4CompatibilityIssue | undefined,
		warnings: readonly string[],
	): void {
		if (readOnly) {
			runtime.setStatus(
				readOnlyIssue?.code === 'EDITABLE_LIMIT_EXCEEDED'
					? runtime.copy.oversizedAup4ReadOnly
					: readOnlyIssue?.message || runtime.copy.newerAup4ReadOnly,
				'error',
			);
			return;
		}
		const warning = warnings.length ? ` ${warnings.join(' ')}` : '';
		runtime.setStatus(`${runtime.copy.aup4Opened}${warning}`, warnings.length ? 'info' : 'success');
	}

	function portableOptions(
		workingBytes: number,
		storage: Readonly<{ usage?: number; quota?: number }>,
		onProgress: (progress: NativeProgress) => void,
	): Aup4PortableOptions {
		return {
			mobile: runtime.state.mobile,
			opfs: environment?.opfs,
			quota: storage.quota,
			usage: storage.usage,
			workingBytes,
			onProgress,
		};
	}

	function beginProjectTask(name: string, expectedProjectId?: string): ProjectTask {
		assertNotDisposed();
		const project = requireProject();
		if (expectedProjectId && project.id !== expectedProjectId) throw projectChangedError();
		return {
			task: runtime.lifetime.startTask(name),
			projectToken: runtime.projectGeneration.capture(project.id),
		};
	}

	function beginImport(task: EditorTaskScope): void {
		importOwner = task;
		runtime.state.importing = true;
		runtime.publishDocumentSnapshot();
	}

	function finishImport(task: EditorTaskScope, token: EditorProjectToken): void {
		if (importOwner !== task) return;
		importOwner = null;
		runtime.state.importing = false;
		if (ownershipIsCurrent(task, token)) runtime.publishDocumentSnapshot();
	}

	function beginSave(task: EditorTaskScope, token: EditorProjectToken): void {
		assertOwnership(task, token);
		saveOwner = task;
		runtime.state.saveState = 'saving';
		runtime.publishDocumentSnapshot();
	}

	function finishSave(task: EditorTaskScope, token: EditorProjectToken, state: 'saved'): void {
		if (saveOwner !== task) throw projectChangedError();
		assertOwnership(task, token);
		runtime.state.saveState = state;
		saveOwner = null;
	}

	function failSave(task: EditorTaskScope, token: EditorProjectToken): void {
		if (saveOwner !== task) return;
		saveOwner = null;
		if (!ownershipIsCurrent(task, token)) return;
		runtime.state.saveState = 'dirty';
		runtime.publishDocumentSnapshot();
	}

	function requireProject(): NativeProjectDocument {
		const activeProject = runtime.getProject();
		if (!activeProject) throw new Error(runtime.copy.projectNotFound);
		return activeProject;
	}

	function requireOwnedProject(projectId: string): NativeProjectDocument {
		const activeProject = requireProject();
		if (activeProject.id !== projectId) throw projectChangedError();
		return activeProject;
	}

	function assertOwnership(task: EditorTaskScope, token: EditorProjectToken): void {
		task.assertCurrent();
		runtime.projectGeneration.assertCurrent(token);
	}

	function ownershipIsCurrent(task: EditorTaskScope, token: EditorProjectToken): boolean {
		try {
			assertOwnership(task, token);
			return true;
		} catch {
			return false;
		}
	}

	function assertNotDisposed(): void {
		if (disposed) throw new EditorDisposedError();
	}
}

interface ProjectTask {
	readonly task: EditorTaskScope;
	readonly projectToken: EditorProjectToken;
}

function sanitizeNativeId(value: string): string {
	return value.replace(/[^a-z0-9_-]/gi, '-');
}

function projectChangedError(): DOMException {
	return new DOMException('The active editor project changed before the operation completed.', 'AbortError');
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
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
