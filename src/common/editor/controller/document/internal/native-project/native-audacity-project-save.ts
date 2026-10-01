/* SPDX-License-Identifier: AGPL-3.0-only */

import { createLocalizedError, setLocalizedStatus } from '../../../../../i18n/presentation-message.ts';
import { isAudioMediaKind } from '../../../../audio-media-kind.ts';
import { hasCoreEditingProjectAuthority } from '../../../../project-schema-version.ts';
import {
	EDITOR_PROJECT_TASK_SCOPE,
	type EditorProjectToken,
	type EditorTaskScope,
} from '../../../shared/lifecycle.ts';
import type {
	Aup4Environment,
	Aup4PortableOptions,
	Aup4SnapshotSource,
	Aup4Validation,
	AudacityProjectGeneration,
	NativeAup4Client,
	NativeCompatibilityReport,
	NativeProgress,
	NativeProjectAudioSource,
	NativeProjectServiceRuntime,
	NativeSavedFile,
	NativeStorageEstimate,
	SaveAup3Options,
	SaveAup4Options,
} from '../../native-project-types.ts';
import type { ProjectTask } from './native-project-ownership.ts';

type SaveResult = Readonly<NativeSavedFile & {
	validation: Aup4Validation;
	compatibilityReport: NativeCompatibilityReport;
}> | Readonly<{ cancelled: true }>;

interface AudacityProjectSaveDependencies {
	readonly assertOwnership: (task: EditorTaskScope, token: EditorProjectToken) => void;
	readonly beginProjectTask: (name: string, expectedProjectId?: string, options?: Readonly<{ scope?: string | null }>) => ProjectTask;
	readonly beginSave: (task: EditorTaskScope, token: EditorProjectToken) => void;
	readonly failSave: (task: EditorTaskScope, token: EditorProjectToken) => void;
	readonly finishSave: (task: EditorTaskScope, token: EditorProjectToken, state: 'saved') => boolean;
	readonly getClient: () => Promise<NativeAup4Client>;
	readonly getEnvironment: () => Aup4Environment | null;
	readonly rememberCompatibilityReport: (
		report: unknown, direction: 'open' | 'save', expectedProjectId?: string,
	) => NativeCompatibilityReport;
	readonly requireOwnedProject: (projectId: string) => NonNullable<ReturnType<NativeProjectServiceRuntime['getProject']>>;
	readonly requireProject: () => NonNullable<ReturnType<NativeProjectServiceRuntime['getProject']>>;
	readonly updateProgress: (
		progress: NativeProgress,
		prefix: string,
		task: EditorTaskScope,
		projectToken: EditorProjectToken,
		localization: Readonly<{ key: string }>,
	) => void;
}

interface AudacitySaveTarget {
	readonly generation: AudacityProjectGeneration;
	readonly idPrefix: string;
	readonly onlyV2Key: string;
	readonly savedKey: string;
	readonly savingCopy: string;
	readonly savingKey: string;
	readonly ensureFileName: (value: unknown) => string;
	readonly requestFileHandle: (options: Readonly<{ fileName: string }>) => Promise<unknown>;
	readonly saveResult: NativeProjectServiceRuntime['saveAup4Result'];
	readonly updatesProjectSaveState: boolean;
}

export function createNativeAudacityProjectSave(
	runtime: NativeProjectServiceRuntime,
	dependencies: AudacityProjectSaveDependencies,
) {
	const saveAup3 = (options: SaveAup3Options = {}): Promise<SaveResult> => saveProject('aup3', options);
	const saveAup4 = (options: SaveAup4Options = {}): Promise<SaveResult> => saveProject('aup4', options);

	async function saveProject(
		generation: AudacityProjectGeneration,
		options: SaveAup3Options | SaveAup4Options,
	): Promise<SaveResult> {
		const target = saveTarget(generation);
		let snapshot = dependencies.requireProject();
		if (!hasCoreEditingProjectAuthority(snapshot)) {
			throw createLocalizedError(Error, runtime.copy, target.onlyV2Key);
		}
		if (runtime.hasMissingTimelineSources(snapshot, { audioOnly: true })
			|| runtime.reportHasMissingPcm(runtime.sessionTab(snapshot.id)?.metadata?.aup4CompatibilityReport)) {
			throw createLocalizedError(Error, runtime.copy, 'missingSourcesPreventSave');
		}
		if (runtime.state.readOnly && !options.saveCopy) {
			throw createLocalizedError(Error, runtime.copy, 'projectReadOnly');
		}
		const operation = dependencies.beginProjectTask(
			'native-project-save', snapshot.id, { scope: EDITOR_PROJECT_TASK_SCOPE },
		);
		const signal = operation.task.signal;
		let fileHandle = options.fileHandle;
		let saveDestination = options.saveTarget;
		let client: NativeAup4Client | null = null;
		let nativeId: string | null = null;
		let nativeCreated = false;
		try {
			if (runtime.fileService.isDesktop && saveDestination === undefined) {
				try {
					saveDestination = await runtime.fileService.chooseSaveTarget({
						purpose: target.generation,
						suggestedName: target.ensureFileName(options.fileName || snapshot.title),
						mimeType: 'application/x-audacity-project',
					});
				} catch (error) {
					if (isAbortError(error)) return { cancelled: true };
					throw error;
				}
				dependencies.assertOwnership(operation.task, operation.projectToken);
				if (!saveDestination) return { cancelled: true };
			} else if (!fileHandle && options.useFileSystemAccess !== false) {
				try {
					fileHandle = await target.requestFileHandle({ fileName: options.fileName || snapshot.title });
				} catch (error) {
					if (isAbortError(error)) return { cancelled: true };
					throw error;
				}
				dependencies.assertOwnership(operation.task, operation.projectToken);
			}
			snapshot = dependencies.requireOwnedProject(snapshot.id);
			const exportSnapshot = runtime.prepareAudacityProjectExport
				? await runtime.prepareAudacityProjectExport(snapshot) : snapshot;
			dependencies.assertOwnership(operation.task, operation.projectToken);
			client = await dependencies.getClient();
			dependencies.assertOwnership(operation.task, operation.projectToken);
			nativeId = sanitizeNativeId(runtime.createStableId(target.idPrefix));
			const referencedSources = snapshot.sources.filter((source): source is NativeProjectAudioSource => (
				isAudioMediaKind(source.kind)
					&& snapshot.clips.some((clip) => isAudioMediaKind(clip.kind) && clip.sourceId === source.id)
			));
			const sourceBytes = referencedSources.reduce(
				(total, source) => total + runtime.sourcePcmBytes(source), 0,
			);
			const workingBytes = referencedSources.reduce(
				(maximum, source) => Math.max(maximum, runtime.sourcePcmBytes(source)), 0,
			);
			await runtime.preflightStorage(sourceBytes, 'export');
			dependencies.assertOwnership(operation.task, operation.projectToken);
			const storage = await runtime.store.estimateStorage();
			dependencies.assertOwnership(operation.task, operation.projectToken);
			const progress = (value: NativeProgress) => dependencies.updateProgress(
				value, target.savingCopy,
				operation.task, operation.projectToken, { key: target.savingKey },
			);
			const portable = portableOptions(
				runtime, dependencies.getEnvironment(), workingBytes, storage, progress, signal,
			);
			setLocalizedStatus(runtime.setStatus, runtime.copy, target.savingKey);
			if (target.updatesProjectSaveState) {
				dependencies.beginSave(operation.task, operation.projectToken);
			}
			await client.create(nativeId, { targetGeneration: target.generation, signal });
			nativeCreated = true;
			dependencies.assertOwnership(operation.task, operation.projectToken);
			const written = await client.writeSnapshot(
				nativeId,
				exportSnapshot,
				readAudacitySourceAudio(runtime, referencedSources, operation, dependencies.assertOwnership),
				portable,
			);
			dependencies.assertOwnership(operation.task, operation.projectToken);
			await client.commit(nativeId, { signal });
			dependencies.assertOwnership(operation.task, operation.projectToken);
			const result = await client.export(nativeId, portable);
			dependencies.assertOwnership(operation.task, operation.projectToken);
			const saved = await target.saveResult(result, {
				fileName: options.fileName || snapshot.title,
				fileHandle,
				fileService: runtime.fileService,
				saveTarget: saveDestination,
				signal,
			});
			dependencies.assertOwnership(operation.task, operation.projectToken);
			if (saved.cancelled) {
				if (target.updatesProjectSaveState) {
					dependencies.failSave(operation.task, operation.projectToken);
				}
				return { cancelled: true };
			}
			const validation = result.validation || await client.inspect(nativeId);
			dependencies.assertOwnership(operation.task, operation.projectToken);
			const compatibilityReport = dependencies.rememberCompatibilityReport(
				written.compatibilityReport || result.compatibilityReport || validation.compatibilityReport,
				'save', snapshot.id,
			);
			dependencies.assertOwnership(operation.task, operation.projectToken);
			const mayPublish = !target.updatesProjectSaveState
				|| dependencies.finishSave(operation.task, operation.projectToken, 'saved');
			if (mayPublish) {
				setLocalizedStatus(runtime.setStatus, runtime.copy, target.savedKey, undefined, 'success');
				runtime.publishDocumentSnapshot();
			}
			return { ...saved, validation, compatibilityReport };
		} catch (error) {
			if (target.updatesProjectSaveState) {
				dependencies.failSave(operation.task, operation.projectToken);
			}
			throw error;
		} finally {
			if (nativeCreated && nativeId) await closeNativeProject(client, nativeId);
			operation.task.finish();
		}
	}

	function saveTarget(generation: AudacityProjectGeneration): AudacitySaveTarget {
		if (generation === 'aup3') return {
			generation,
			idPrefix: 'aup3-export',
			onlyV2Key: 'aup3OnlyV2',
			savedKey: 'aup3Saved',
			savingCopy: runtime.copy.aup3Saving,
			savingKey: 'aup3Saving',
			ensureFileName: runtime.ensureAup3FileName,
			requestFileHandle: runtime.requestAup3FileHandle,
			saveResult: runtime.saveAup3Result,
			updatesProjectSaveState: false,
		};
		return {
			generation,
			idPrefix: 'aup4-export',
			onlyV2Key: 'aup4OnlyV2',
			savedKey: 'aup4Saved',
			savingCopy: runtime.copy.aup4Saving,
			savingKey: 'aup4Saving',
			ensureFileName: runtime.ensureAup4FileName,
			requestFileHandle: runtime.requestAup4FileHandle,
			saveResult: runtime.saveAup4Result,
			updatesProjectSaveState: true,
		};
	}

	return Object.freeze({ saveAup3, saveAup4 });
}

async function* readAudacitySourceAudio(
	runtime: NativeProjectServiceRuntime,
	sources: readonly NativeProjectAudioSource[],
	operation: ProjectTask,
	assertOwnership: AudacityProjectSaveDependencies['assertOwnership'],
): AsyncGenerator<Aup4SnapshotSource> {
	for (const source of sources) {
		assertOwnership(operation.task, operation.projectToken);
		const buffer = runtime.sourceBuffers.get(source.id);
		const channels = buffer
			? Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel))
			: await runtime.loadStoredSourceChannels(runtime.store, source);
		assertOwnership(operation.task, operation.projectToken);
		if (!channels?.length) {
			throw createLocalizedError(Error, runtime.copy, 'sourcePcmUnavailable', {
				source: source.name || source.id,
			});
		}
		yield { sourceId: source.id, sampleRate: source.sampleRate, channels };
	}
}

function portableOptions(
	runtime: NativeProjectServiceRuntime,
	environment: Aup4Environment | null,
	workingBytes: number,
	storage: Readonly<Partial<NativeStorageEstimate>>,
	onProgress: (progress: NativeProgress) => void,
	signal: AbortSignal,
): Aup4PortableOptions {
	return {
		mobile: runtime.state.mobile,
		opfs: environment?.opfs,
		quota: storage.quota ?? undefined,
		usage: storage.usage ?? undefined,
		workingBytes,
		onProgress,
		signal,
	};
}

function sanitizeNativeId(value: string): string {
	return value.replace(/[^a-z0-9_-]/gi, '-');
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
		// Staging cleanup is best-effort and must not mask the save result.
	}
}
