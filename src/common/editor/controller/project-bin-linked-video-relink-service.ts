/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	EditorControllerLifetime,
	EditorProjectToken,
	EditorTaskScope,
} from './lifecycle.ts';
import { PROJECT_BIN_LINKED_ORIGINAL_RELINK_TASK } from './project-bin-linked-original-relink-task.ts';

export const PROJECT_BIN_LINKED_VIDEO_RELINK_TASK = PROJECT_BIN_LINKED_ORIGINAL_RELINK_TASK;

type MaybePromise<Value> = PromiseLike<Value> | Value;

export interface ProjectBinLinkedVideoRelinkLocator {
	readonly locatorId: string;
	readonly locatorRevision: string;
}

export interface ProjectBinLinkedVideoRelinkBinding extends ProjectBinLinkedVideoRelinkLocator {
	readonly bindingToken: string;
	readonly byteLength: number;
	readonly sha256: string;
}

interface ProjectBinLinkedVideoRelinkSource {
	readonly id: string;
	readonly kind?: string;
	readonly hasAudio?: boolean;
}

interface ProjectBinLinkedVideoRelinkClip {
	readonly id: string;
	readonly sourceId: string;
	readonly binItemId?: string | null;
}

interface ProjectBinLinkedVideoRelinkProject {
	readonly id: string;
	readonly sources: readonly ProjectBinLinkedVideoRelinkSource[];
	readonly projectBin?: Readonly<{ readonly clips?: readonly ProjectBinLinkedVideoRelinkClip[] }>;
}

type VideoSource = ProjectBinLinkedVideoRelinkSource & Readonly<{ kind: 'video' }>;

interface RelinkOptions {
	readonly admission?: 'exact-content' | 'changed-content';
	readonly expectedBindingToken: string;
	readonly expectedLocatorRevision: string;
	readonly expectedSnapshot: Blob;
	assertCanPublish(): void;
	readonly signal: AbortSignal;
}

export interface ProjectBinLinkedVideoRelinkDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive' | 'startTask' | 'cancelTask'>;
	readonly missingSourceIds: Readonly<{
		has(sourceId: string): boolean;
		add(sourceId: string): unknown;
		delete(sourceId: string): boolean;
	}>;
	editingBlocked(): boolean;
	getProject(): ProjectBinLinkedVideoRelinkProject;
	captureProject(): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	getLinkedVideoOriginalBinding(
		projectId: string,
		sourceId: string,
	): MaybePromise<ProjectBinLinkedVideoRelinkBinding | null>;
	stopTimelinePlayback(): MaybePromise<unknown>;
	stopProjectBinPreview(): MaybePromise<unknown>;
	revokeVideoVisual(sourceId: string): MaybePromise<unknown>;
	relinkLinkedVideoOriginal(
		projectId: string,
		source: VideoSource,
		locatorId: string,
		options: Readonly<RelinkOptions>,
	): MaybePromise<ProjectBinLinkedVideoRelinkBinding>;
	releaseLinkedVideoOriginalLocator(
		reference: ProjectBinLinkedVideoRelinkLocator,
	): MaybePromise<boolean>;
	activateVideoSource(
		source: VideoSource,
		options: Readonly<{ signal: AbortSignal }>,
	): MaybePromise<unknown>;
	digestContent(blob: Blob, options: Readonly<{ signal?: AbortSignal }>): MaybePromise<string>;
	admitChangedContentCandidate(
		file: Blob,
		source: VideoSource,
		options: Readonly<{ signal: AbortSignal }>,
	): MaybePromise<unknown>;
	deleteVideoDerivatives(sourceId: string): MaybePromise<unknown>;
	publish(): void;
}

export type ProjectBinLinkedVideoRelinkClassification = 'exact-content' | 'changed-content';

export interface ProjectBinLinkedVideoRelinkService {
	canRelinkLinkedVideo(clipId: string): Promise<boolean>;
	classifyLinkedVideoRelink(
		clipId: string,
		file: Blob,
	): Promise<ProjectBinLinkedVideoRelinkClassification>;
	relinkLinkedVideo(
		clipId: string,
		file: Blob,
		locator: ProjectBinLinkedVideoRelinkLocator,
		options?: Readonly<{ allowChangedContent?: boolean }>,
	): Promise<string>;
	dispose(): Promise<void>;
}

/**
 * Rebind one Project Bin linked video without changing project or history.
 * The binding publication is the ownership boundary for the selected locator.
 */
export function createProjectBinLinkedVideoRelinkService(
	dependencies: ProjectBinLinkedVideoRelinkDependencies,
): Readonly<ProjectBinLinkedVideoRelinkService> {
	const settlements = new Set<Promise<void>>();
	const cleanupFailures: unknown[] = [];
	let operationSequence = 0;
	let disposed = false;
	let disposal: Promise<void> | null = null;
	return Object.freeze({ canRelinkLinkedVideo, classifyLinkedVideoRelink, relinkLinkedVideo, dispose });

	async function classifyLinkedVideoRelink(
		clipId: string,
		file: Blob,
	): Promise<ProjectBinLinkedVideoRelinkClassification> {
		assertNotDisposed(disposed);
		dependencies.lifetime.assertActive();
		const project = dependencies.getProject();
		const projectToken = dependencies.captureProject();
		const source = compoundVideoSource(project, clipId, true) as VideoSource;
		const binding = await dependencies.getLinkedVideoOriginalBinding(project.id, source.id);
		assertNotDisposed(disposed);
		dependencies.lifetime.assertActive();
		dependencies.assertProject(projectToken);
		if (!binding) {
			throw new Error('The Project Bin video is not currently bound to a linked original.');
		}
		if (file.size !== binding.byteLength) return 'changed-content';
		const digest = await dependencies.digestContent(file, {});
		assertNotDisposed(disposed);
		dependencies.lifetime.assertActive();
		dependencies.assertProject(projectToken);
		return digest === binding.sha256 ? 'exact-content' : 'changed-content';
	}

	async function canRelinkLinkedVideo(clipId: string): Promise<boolean> {
		assertNotDisposed(disposed);
		dependencies.lifetime.assertActive();
		const project = dependencies.getProject();
		const projectToken = dependencies.captureProject();
		const source = compoundVideoSource(project, clipId, false);
		if (!source) return false;
		const binding = await dependencies.getLinkedVideoOriginalBinding(project.id, source.id);
		assertNotDisposed(disposed);
		dependencies.lifetime.assertActive();
		dependencies.assertProject(projectToken);
		return Boolean(binding);
	}

	function relinkLinkedVideo(
		clipId: string,
		file: Blob,
		locator: ProjectBinLinkedVideoRelinkLocator,
		relinkOptions: Readonly<{ allowChangedContent?: boolean }> = {},
	): Promise<string> {
		const operation = performRelink(clipId, file, locator, relinkOptions);
		const settlement: Promise<void> = operation.then(() => undefined, () => undefined).finally(() => {
			settlements.delete(settlement);
		});
		settlements.add(settlement);
		return operation;
	}

	async function performRelink(
		clipId: string,
		file: Blob,
		locator: ProjectBinLinkedVideoRelinkLocator,
		relinkOptions: Readonly<{ allowChangedContent?: boolean }>,
	): Promise<string> {
		const candidate = locatorSnapshot(locator);
		let operationId = 0;
		let task: EditorTaskScope | null = null;
		let projectToken: EditorProjectToken | null = null;
		let source: VideoSource | null = null;
		let oldBinding: ProjectBinLinkedVideoRelinkBinding | null = null;
		let wasMissing = false;
		let revocationStarted = false;
		let published = false;
		let activationStarted = false;
		let activated = false;
		try {
			assertNotDisposed(disposed);
			task = dependencies.lifetime.startTask(PROJECT_BIN_LINKED_VIDEO_RELINK_TASK);
			const activeTask = task;
			const project = dependencies.getProject();
			projectToken = dependencies.captureProject();
			assertWritable(dependencies);
			source = compoundVideoSource(project, clipId, true) as VideoSource;
			oldBinding = await dependencies.getLinkedVideoOriginalBinding(project.id, source.id);
			assertCurrent(dependencies, activeTask, projectToken);
			assertWritable(dependencies);
			if (!oldBinding) {
				throw new Error('The Project Bin video is not currently bound to a linked original.');
			}
			const changedContent = file.size !== oldBinding.byteLength
				|| await dependencies.digestContent(file, { signal: activeTask.signal }) !== oldBinding.sha256;
			assertCurrent(dependencies, activeTask, projectToken);
			assertWritable(dependencies);
			if (changedContent) {
				if (relinkOptions.allowChangedContent !== true) {
					throw new Error(
						'The selected linked video original has changed content; '
						+ 'changed-content relink requires explicit confirmation.',
					);
				}
				if (source.hasAudio !== false) {
					throw new Error(
						'The linked video source retains canonical extracted audio; '
						+ 'changed-content relink requires a silent video source.',
					);
				}
				if (itemHasAudioMember(project, clipId)) {
					throw new Error(
						'The Project Bin item pairs the video with an audio member; '
						+ 'changed-content relink requires a silent video item.',
					);
				}
				await dependencies.admitChangedContentCandidate(file, source, { signal: activeTask.signal });
				assertCurrent(dependencies, activeTask, projectToken);
				assertWritable(dependencies);
			}
			wasMissing = dependencies.missingSourceIds.has(source.id);

			await dependencies.stopTimelinePlayback();
			assertCurrent(dependencies, activeTask, projectToken);
			await dependencies.stopProjectBinPreview();
			assertCurrent(dependencies, activeTask, projectToken);
			operationId = ++operationSequence;
			revocationStarted = true;
			await dependencies.revokeVideoVisual(source.id);
			assertCurrent(dependencies, activeTask, projectToken);
			assertWritable(dependencies);
			assertAvailabilityStable(dependencies, source.id, wasMissing);

			const activeSource = source;
			const activeToken = projectToken;
			const rebound = await dependencies.relinkLinkedVideoOriginal(
				project.id,
				source,
				candidate.locatorId,
				Object.freeze({
					...(changedContent ? { admission: 'changed-content' as const } : {}),
					expectedBindingToken: oldBinding.bindingToken,
					expectedLocatorRevision: candidate.locatorRevision,
					expectedSnapshot: file,
					assertCanPublish: () => {
						assertCurrent(dependencies, activeTask, activeToken);
						assertWritable(dependencies);
						assertAvailabilityStable(dependencies, activeSource.id, wasMissing);
					},
					signal: activeTask.signal,
				}),
			);
			published = true;
			assertCurrent(dependencies, activeTask, projectToken);
			if (!sameLocator(rebound, candidate)) {
				throw new Error('The linked-video relink published an unexpected locator snapshot.');
			}
			if (changedContent) {
				try { await dependencies.deleteVideoDerivatives(source.id); }
				catch (purgeError) { cleanupFailures.push(purgeError); }
				assertCurrent(dependencies, activeTask, projectToken);
			}

			activationStarted = true;
			const visual = await dependencies.activateVideoSource(source, { signal: activeTask.signal });
			if (visual === null) throw new Error('The relinked Project Bin video could not be activated.');
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
					revocationStarted && !wasMissing,
					task,
				);
			}
			if (!activated && source && projectToken && operationOwnsProject(projectToken, operationId)) {
				const failures: unknown[] = [];
				if (activationStarted) {
					try { await dependencies.revokeVideoVisual(source.id); }
					catch (cleanupError) { failures.push(cleanupError); }
				}
				if (operationOwnsProject(projectToken, operationId)
					&& !dependencies.missingSourceIds.has(source.id)) {
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
						'Linked-video relink activation cleanup failed.',
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
		candidate: ProjectBinLinkedVideoRelinkLocator,
		oldBinding: ProjectBinLinkedVideoRelinkBinding | null,
		source: VideoSource | null,
		projectToken: EditorProjectToken | null,
		operationId: number,
		restoreVisual: boolean,
		task: EditorTaskScope | null,
	): Promise<unknown> {
		const failures: unknown[] = [];
		if (restoreVisual && source && projectToken && task
			&& operationOwnsProject(projectToken, operationId)) {
			let recoveryStarted = false;
			try {
				recoveryStarted = true;
				const visual = await dependencies.activateVideoSource(source, { signal: task.signal });
				if (visual === null) {
					throw new Error('The previous Project Bin video could not be restored.');
				}
				if (operationOwnsProject(projectToken, operationId)
					&& dependencies.missingSourceIds.has(source.id)) {
					dependencies.missingSourceIds.delete(source.id);
					dependencies.publish();
				}
			} catch (recoveryError) {
				failures.push(recoveryError);
				if (recoveryStarted && operationOwnsProject(projectToken, operationId)) {
					try { await dependencies.revokeVideoVisual(source.id); }
					catch (cleanupError) { failures.push(cleanupError); }
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
				if (!await dependencies.releaseLinkedVideoOriginalLocator(candidate)) {
					throw new Error('The unused linked-video relink locator was not released.');
				}
			} catch (cleanupError) {
				failures.push(cleanupError);
			}
		}
		if (!failures.length) return primary;
		const failure = new AggregateError(
			[primary, ...failures],
			'Linked-video relink and prepublication cleanup both failed.',
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
		dependencies.lifetime.cancelTask(PROJECT_BIN_LINKED_VIDEO_RELINK_TASK);
		disposal = Promise.all([...settlements]).then(() => {
			if (cleanupFailures.length) {
				throw new AggregateError(
					[...cleanupFailures],
					'Linked-video relink candidate cleanup failed during disposal.',
				);
			}
		});
		return disposal;
	}
}

function compoundVideoSource(
	project: ProjectBinLinkedVideoRelinkProject,
	clipId: string,
	required: boolean,
): VideoSource | null {
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
	const videos = new Map<string, VideoSource>();
	for (const clip of itemClips) {
		const source = sourceById.get(clip.sourceId);
		if (source?.kind === 'video') videos.set(source.id, source as VideoSource);
	}
	if (videos.size !== 1) {
		if (required) {
			throw new Error('The Project Bin item must contain exactly one video source to relink.');
		}
		return null;
	}
	return [...videos.values()][0] as VideoSource;
}

function itemHasAudioMember(
	project: ProjectBinLinkedVideoRelinkProject,
	clipId: string,
): boolean {
	const clips = Array.isArray(project.projectBin?.clips) ? project.projectBin.clips : [];
	const selected = clips.find((clip) => clip.id === clipId);
	if (!selected) return false;
	const itemClips = selected.binItemId
		? clips.filter((clip) => clip.binItemId === selected.binItemId)
		: [selected];
	const sourceById = new Map(project.sources.map((source) => [source.id, source]));
	return itemClips.some((clip) => sourceById.get(clip.sourceId)?.kind === 'audio');
}

function assertNotDisposed(disposed: boolean): void {
	if (disposed) throw new DOMException('The linked-video relink service is disposed.', 'AbortError');
}

function assertCurrent(
	dependencies: Pick<ProjectBinLinkedVideoRelinkDependencies, 'assertProject'>,
	task: EditorTaskScope,
	projectToken: EditorProjectToken,
): void {
	task.assertCurrent();
	dependencies.assertProject(projectToken);
}

function assertWritable(
	dependencies: Pick<ProjectBinLinkedVideoRelinkDependencies, 'editingBlocked'>,
): void {
	if (dependencies.editingBlocked()) throw new Error('Project editing is blocked.');
}

function assertAvailabilityStable(
	dependencies: Pick<ProjectBinLinkedVideoRelinkDependencies, 'missingSourceIds'>,
	sourceId: string,
	wasMissing: boolean,
): void {
	if (wasMissing && !dependencies.missingSourceIds.has(sourceId)) {
		throw new Error('The linked Project Bin video became available before relink publication.');
	}
}

function locatorSnapshot(locator: ProjectBinLinkedVideoRelinkLocator): ProjectBinLinkedVideoRelinkLocator {
	if (!locator || typeof locator !== 'object'
		|| typeof locator.locatorId !== 'string' || !locator.locatorId
		|| typeof locator.locatorRevision !== 'string' || !locator.locatorRevision) {
		throw new TypeError('An exact linked-video locator snapshot is required.');
	}
	return Object.freeze({
		locatorId: locator.locatorId,
		locatorRevision: locator.locatorRevision,
	});
}

function sameLocator(
	left: ProjectBinLinkedVideoRelinkLocator | null,
	right: ProjectBinLinkedVideoRelinkLocator,
): boolean {
	return left?.locatorId === right.locatorId
		&& left.locatorRevision === right.locatorRevision;
}
