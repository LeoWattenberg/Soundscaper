/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	EditorControllerLifetime,
	EditorProjectToken,
	EditorTaskScope,
} from './lifecycle.ts';
import { PROJECT_BIN_LINKED_ORIGINAL_RELINK_TASK } from './project-bin-linked-original-relink-task.ts';

export const PROJECT_BIN_LINKED_AUDIO_RELINK_TASK = PROJECT_BIN_LINKED_ORIGINAL_RELINK_TASK;

type MaybePromise<Value> = PromiseLike<Value> | Value;

export interface ProjectBinLinkedAudioRelinkLocator {
	readonly locatorId: string;
	readonly locatorRevision: string;
}

export interface ProjectBinLinkedAudioRelinkBinding extends ProjectBinLinkedAudioRelinkLocator {
	readonly kind: 'audio';
	readonly bindingToken: string;
}

interface LinkedOriginalBinding extends ProjectBinLinkedAudioRelinkLocator {
	readonly kind: string;
	readonly bindingToken: string;
}

interface ProjectBinLinkedAudioRelinkSource {
	readonly id: string;
	readonly kind?: string;
	readonly storageKey?: string | null;
}

interface ProjectBinLinkedAudioRelinkClip {
	readonly id: string;
	readonly sourceId: string;
	readonly binItemId?: string | null;
}

interface ProjectBinLinkedAudioRelinkProject {
	readonly id: string;
	readonly revision: number;
	readonly sources: readonly ProjectBinLinkedAudioRelinkSource[];
	readonly projectBin?: Readonly<{
		readonly clips?: readonly ProjectBinLinkedAudioRelinkClip[];
	}>;
}

type AudioSource = ProjectBinLinkedAudioRelinkSource & Readonly<{ kind: 'audio' }>;

interface RelinkOptions {
	readonly expectedBindingToken: string;
	readonly expectedLocatorRevision: string;
	readonly expectedSnapshot: Blob;
	assertCanPublish(): void;
	readonly signal: AbortSignal;
}

interface LinkedAudioLocatorReference extends ProjectBinLinkedAudioRelinkLocator {
	readonly kind: 'audio';
}

export interface ProjectBinLinkedAudioRelinkDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive' | 'startTask' | 'cancelTask'>;
	readonly missingSourceIds: Readonly<{
		has(sourceId: string): boolean;
		add(sourceId: string): unknown;
		delete(sourceId: string): boolean;
	}>;
	editingBlocked(): boolean;
	getProject(): ProjectBinLinkedAudioRelinkProject;
	captureProject(): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	getLinkedOriginalBinding(
		projectId: string,
		sourceId: string,
	): MaybePromise<LinkedOriginalBinding | null>;
	stopTimelinePlayback(): MaybePromise<unknown>;
	stopProjectBinPreview(options: Readonly<{ dispose: true }>): MaybePromise<unknown>;
	retireSourceChunkProvider(sourceId: string): MaybePromise<void>;
	relinkLinkedAudioOriginal(
		projectId: string,
		source: AudioSource,
		locatorId: string,
		options: Readonly<RelinkOptions>,
	): MaybePromise<ProjectBinLinkedAudioRelinkBinding>;
	releaseLinkedOriginalLocator(reference: LinkedAudioLocatorReference): MaybePromise<boolean>;
	invalidateSourceRuntime(sourceId: string): MaybePromise<void>;
	getSourceMetadata(storageKey: string): MaybePromise<unknown>;
	activateStoredSource(source: AudioSource, metadata: unknown): MaybePromise<unknown>;
	publish(): void;
}

export interface ProjectBinLinkedAudioRelinkService {
	canRelinkLinkedAudio(clipId: string): Promise<boolean>;
	relinkLinkedAudio(
		clipId: string,
		file: Blob,
		locator: ProjectBinLinkedAudioRelinkLocator,
		target: ProjectBinLinkedAudioRelinkTarget,
	): Promise<string>;
	dispose(): Promise<void>;
}

export interface ProjectBinLinkedAudioRelinkTarget {
	readonly projectId: string;
	readonly projectRevision: number;
}

/**
 * Rebind one Project Bin linked-PCM source without changing the project document.
 * Storage publication is the ownership boundary for the selected locator.
 */
export function createProjectBinLinkedAudioRelinkService(
	dependencies: ProjectBinLinkedAudioRelinkDependencies,
): Readonly<ProjectBinLinkedAudioRelinkService> {
	const settlements = new Set<Promise<void>>();
	const cleanupFailures: unknown[] = [];
	let operationSequence = 0;
	let disposed = false;
	let disposal: Promise<void> | null = null;

	return Object.freeze({ canRelinkLinkedAudio, relinkLinkedAudio, dispose });

	async function canRelinkLinkedAudio(clipId: string): Promise<boolean> {
		assertNotDisposed(disposed);
		dependencies.lifetime.assertActive();
		const project = dependencies.getProject();
		const projectToken = dependencies.captureProject();
		const source = compoundAudioSource(project, clipId, false);
		if (!source) return false;
		const binding = await dependencies.getLinkedOriginalBinding(project.id, source.id);
		assertNotDisposed(disposed);
		dependencies.lifetime.assertActive();
		dependencies.assertProject(projectToken);
		return binding?.kind === 'audio';
	}

	function relinkLinkedAudio(
		clipId: string,
		file: Blob,
		locator: ProjectBinLinkedAudioRelinkLocator,
		target: ProjectBinLinkedAudioRelinkTarget,
	): Promise<string> {
		const operation = performRelink(clipId, file, locator, target);
		const settlement: Promise<void> = operation.then(() => undefined, () => undefined).finally(() => {
			settlements.delete(settlement);
		});
		settlements.add(settlement);
		return operation;
	}

	async function performRelink(
		clipId: string,
		file: Blob,
		locator: ProjectBinLinkedAudioRelinkLocator,
		target: ProjectBinLinkedAudioRelinkTarget,
	): Promise<string> {
		const candidate = locatorSnapshot(locator);
		let operationId = 0;
		let task: EditorTaskScope | null = null;
		let projectToken: EditorProjectToken | null = null;
		let source: AudioSource | null = null;
		let oldBinding: ProjectBinLinkedAudioRelinkBinding | null = null;
		let retirementStarted = false;
		let published = false;
		let activationStarted = false;
		let activated = false;
		try {
			const expectedTarget = projectTargetSnapshot(target);
			if (disposed) throw new DOMException('The linked-audio relink service is disposed.', 'AbortError');
			const project = dependencies.getProject();
			assertProjectTarget(project, expectedTarget);
			task = dependencies.lifetime.startTask(PROJECT_BIN_LINKED_AUDIO_RELINK_TASK);
			const activeTask = task;
			projectToken = dependencies.captureProject();
			assertWritable(dependencies);
			source = compoundAudioSource(project, clipId, true);
			const binding = await dependencies.getLinkedOriginalBinding(project.id, source.id);
			assertCurrent(dependencies, activeTask, projectToken);
			assertWritable(dependencies);
			if (binding?.kind !== 'audio') {
				throw new Error('The Project Bin audio source is not currently bound to a linked audio original.');
			}
			oldBinding = binding as ProjectBinLinkedAudioRelinkBinding;

			await dependencies.stopTimelinePlayback();
			assertCurrent(dependencies, activeTask, projectToken);
			await dependencies.stopProjectBinPreview({ dispose: true });
			assertCurrent(dependencies, activeTask, projectToken);
			operationId = ++operationSequence;
			retirementStarted = true;
			await dependencies.retireSourceChunkProvider(source.id);
			assertCurrent(dependencies, activeTask, projectToken);
			assertWritable(dependencies);

			const rebound = await dependencies.relinkLinkedAudioOriginal(
				project.id,
				source,
				candidate.locatorId,
				Object.freeze({
					expectedBindingToken: oldBinding.bindingToken,
					expectedLocatorRevision: candidate.locatorRevision,
					expectedSnapshot: file,
					assertCanPublish: () => {
						assertCurrent(dependencies, activeTask, projectToken as EditorProjectToken);
						assertProjectTarget(dependencies.getProject(), expectedTarget);
						assertWritable(dependencies);
					},
					signal: activeTask.signal,
				}),
			);
			published = true;
			assertCurrent(dependencies, activeTask, projectToken);
			if (rebound.kind !== 'audio' || !sameLocator(rebound, candidate)) {
				throw new Error('The linked-audio relink published an unexpected locator snapshot.');
			}

			await dependencies.invalidateSourceRuntime(source.id);
			assertCurrent(dependencies, activeTask, projectToken);
			const metadata = requiredSourceMetadata(
				await dependencies.getSourceMetadata(source.storageKey || source.id),
			);
			assertCurrent(dependencies, activeTask, projectToken);
			activationStarted = true;
			const activation = await dependencies.activateStoredSource(source, metadata);
			if (activation == null) {
				throw new Error('The relinked Project Bin audio source could not be activated.');
			}
			activated = true;
			assertCurrent(dependencies, activeTask, projectToken);
			dependencies.missingSourceIds.delete(source.id);
			dependencies.publish();
			return source.id;
		} catch (error) {
			if (!published) {
				throw await handlePrepublicationFailure(
					error,
					candidate,
					oldBinding,
					source,
					projectToken,
					operationId,
					retirementStarted,
				);
			}
			if (activated && source && projectToken && operationOwnsProject(projectToken, operationId)) {
				try {
					dependencies.missingSourceIds.delete(source.id);
					dependencies.publish();
				} catch (stateError) {
					const failure = new AggregateError(
						[error, stateError],
						'Linked-audio relink availability publication failed.',
						{ cause: error },
					);
					cleanupFailures.push(failure);
					throw failure;
				}
			}
			if (!activated && source && projectToken) {
				const failures: unknown[] = [];
				if (activationStarted && operationOwnsProject(projectToken, operationId)) {
					try { await dependencies.retireSourceChunkProvider(source.id); }
					catch (cleanupError) { failures.push(cleanupError); }
					if (operationOwnsProject(projectToken, operationId)) {
						try { await dependencies.invalidateSourceRuntime(source.id); }
						catch (cleanupError) { failures.push(cleanupError); }
					}
				}
				if (operationOwnsProject(projectToken, operationId)) {
					try {
						dependencies.missingSourceIds.add(source.id);
						dependencies.publish();
					} catch (stateError) {
						failures.push(stateError);
					}
				}
				if (failures.length) {
					const failure = new AggregateError(
						[error, ...failures],
						'Linked-audio relink activation cleanup failed.',
						{ cause: error },
					);
					cleanupFailures.push(failure);
					throw failure;
				}
			}
			throw error;
		} finally {
			task?.finish();
		}
	}

	async function handlePrepublicationFailure(
		primary: unknown,
		candidate: ProjectBinLinkedAudioRelinkLocator,
		oldBinding: ProjectBinLinkedAudioRelinkBinding | null,
		source: AudioSource | null,
		projectToken: EditorProjectToken | null,
		operationId: number,
		retirementStarted: boolean,
	): Promise<unknown> {
		const failures: unknown[] = [];
		if (retirementStarted && source && projectToken
			&& operationOwnsProject(projectToken, operationId)) {
			let recoveryActivationStarted = false;
			try {
				const metadata = requiredSourceMetadata(
					await dependencies.getSourceMetadata(source.storageKey || source.id),
				);
				if (operationOwnsProject(projectToken, operationId)) {
					recoveryActivationStarted = true;
					const activation = await dependencies.activateStoredSource(source, metadata);
					if (activation == null) {
						throw new Error('The previous Project Bin audio source could not be restored.');
					}
					if (operationOwnsProject(projectToken, operationId)
						&& dependencies.missingSourceIds.has(source.id)) {
						dependencies.missingSourceIds.delete(source.id);
						dependencies.publish();
					}
				}
			} catch (recoveryError) {
				failures.push(recoveryError);
				if (recoveryActivationStarted && operationOwnsProject(projectToken, operationId)) {
					try { await dependencies.retireSourceChunkProvider(source.id); }
					catch (cleanupError) { failures.push(cleanupError); }
					if (operationOwnsProject(projectToken, operationId)) {
						try { await dependencies.invalidateSourceRuntime(source.id); }
						catch (cleanupError) { failures.push(cleanupError); }
					}
				}
				if (operationOwnsProject(projectToken, operationId)) {
					try {
						dependencies.missingSourceIds.add(source.id);
						dependencies.publish();
					} catch (stateError) {
						failures.push(stateError);
					}
				}
			}
		}
		if (!sameLocator(oldBinding, candidate)) {
			try {
				if (!await dependencies.releaseLinkedOriginalLocator({ kind: 'audio', ...candidate })) {
					throw new Error('The unused linked-audio relink locator was not released.');
				}
			} catch (cleanupError) {
				failures.push(cleanupError);
			}
		}
		if (!failures.length) return primary;
		const failure = new AggregateError(
			[primary, ...failures],
			'Linked-audio relink and prepublication cleanup both failed.',
			{ cause: primary },
		);
		cleanupFailures.push(failure);
		return failure;
	}

	function operationOwnsProject(projectToken: EditorProjectToken, operationId: number): boolean {
		if (disposed || operationId !== operationSequence) return false;
		try {
			dependencies.lifetime.assertActive();
			dependencies.assertProject(projectToken);
			return true;
		} catch {
			return false;
		}
	}

	function dispose(): Promise<void> {
		if (disposal) return disposal;
		disposed = true;
		dependencies.lifetime.cancelTask(PROJECT_BIN_LINKED_AUDIO_RELINK_TASK);
		disposal = Promise.all([...settlements]).then(() => {
			if (cleanupFailures.length) {
				throw new AggregateError(
					[...cleanupFailures],
					'Linked-audio relink cleanup failed during disposal.',
				);
			}
		});
		return disposal;
	}
}

function assertNotDisposed(disposed: boolean): void {
	if (disposed) throw new DOMException('The linked-audio relink service is disposed.', 'AbortError');
}

function requiredSourceMetadata(value: unknown): object {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error('The linked Project Bin audio source has no stored metadata.');
	}
	return value;
}

function compoundAudioSource(
	project: ProjectBinLinkedAudioRelinkProject,
	clipId: string,
	required: true,
): AudioSource;
function compoundAudioSource(
	project: ProjectBinLinkedAudioRelinkProject,
	clipId: string,
	required: false,
): AudioSource | null;
function compoundAudioSource(
	project: ProjectBinLinkedAudioRelinkProject,
	clipId: string,
	required: boolean,
): AudioSource | null {
	const clips = Array.isArray(project.projectBin?.clips) ? project.projectBin.clips : [];
	const selected = clips.find((clip) => clip.id === clipId);
	if (!selected) {
		if (required) throw new Error('The Project Bin item is unavailable.');
		return null;
	}
	const itemClips = selected.binItemId
		? clips.filter((clip) => clip.binItemId === selected.binItemId)
		: [selected];
	const sourceById = new Map(project.sources.map((source) => [source.id, source]));
	const audioSources = new Map<string, AudioSource>();
	for (const clip of itemClips) {
		const source = sourceById.get(clip.sourceId);
		if (source?.kind === 'audio') audioSources.set(source.id, source as AudioSource);
	}
	if (audioSources.size !== 1) {
		if (required) {
			throw new Error('The Project Bin item must contain exactly one audio source to relink.');
		}
		return null;
	}
	return [...audioSources.values()][0] as AudioSource;
}

function assertCurrent(
	dependencies: Pick<ProjectBinLinkedAudioRelinkDependencies, 'assertProject'>,
	task: EditorTaskScope,
	projectToken: EditorProjectToken,
): void {
	task.assertCurrent();
	dependencies.assertProject(projectToken);
}

function assertWritable(
	dependencies: Pick<ProjectBinLinkedAudioRelinkDependencies, 'editingBlocked'>,
): void {
	if (dependencies.editingBlocked()) throw new Error('Project editing is blocked.');
}

function locatorSnapshot(locator: ProjectBinLinkedAudioRelinkLocator): ProjectBinLinkedAudioRelinkLocator {
	if (!locator || typeof locator !== 'object'
		|| typeof locator.locatorId !== 'string' || !locator.locatorId
		|| typeof locator.locatorRevision !== 'string' || !locator.locatorRevision) {
		throw new TypeError('An exact linked-audio locator snapshot is required.');
	}
	return Object.freeze({
		locatorId: locator.locatorId,
		locatorRevision: locator.locatorRevision,
	});
}

function projectTargetSnapshot(target: ProjectBinLinkedAudioRelinkTarget): ProjectBinLinkedAudioRelinkTarget {
	if (!target || typeof target !== 'object'
		|| typeof target.projectId !== 'string' || !target.projectId
		|| !Number.isSafeInteger(target.projectRevision) || target.projectRevision < 0) {
		throw new TypeError('An exact linked-audio project target is required.');
	}
	return Object.freeze({ projectId: target.projectId, projectRevision: target.projectRevision });
}

function assertProjectTarget(
	project: ProjectBinLinkedAudioRelinkProject,
	target: ProjectBinLinkedAudioRelinkTarget,
): void {
	if (project.id !== target.projectId || project.revision !== target.projectRevision) {
		throw new DOMException('The linked-audio relink project target changed.', 'AbortError');
	}
}

function sameLocator(
	left: ProjectBinLinkedAudioRelinkLocator | null,
	right: ProjectBinLinkedAudioRelinkLocator,
): boolean {
	return left?.locatorId === right.locatorId
		&& left.locatorRevision === right.locatorRevision;
}
