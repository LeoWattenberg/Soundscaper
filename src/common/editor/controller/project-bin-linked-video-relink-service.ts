/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	EditorControllerLifetime,
	EditorProjectToken,
	EditorTaskScope,
} from './lifecycle.ts';

export const PROJECT_BIN_LINKED_VIDEO_RELINK_TASK = 'project-bin-linked-video-relink';

export interface ProjectBinLinkedVideoRelinkLocator {
	readonly locatorId: string;
	readonly locatorRevision: string;
}

export interface ProjectBinLinkedVideoRelinkBinding extends ProjectBinLinkedVideoRelinkLocator {
	readonly bindingToken: string;
}

interface ProjectBinLinkedVideoRelinkSource {
	readonly id: string;
	readonly kind?: string;
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
	readonly expectedBindingToken: string;
	readonly expectedLocatorRevision: string;
	readonly expectedSnapshot: Blob;
	assertCanPublish(): void;
	readonly signal: AbortSignal;
}

export interface ProjectBinLinkedVideoRelinkDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'startTask' | 'cancelTask'>;
	readonly missingSourceIds: Readonly<{
		has(sourceId: string): boolean;
		delete(sourceId: string): boolean;
	}>;
	editingBlocked(): boolean;
	getProject(): ProjectBinLinkedVideoRelinkProject;
	captureProject(): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	getLinkedVideoOriginalBinding(
		projectId: string,
		sourceId: string,
	): PromiseLike<ProjectBinLinkedVideoRelinkBinding | null> | ProjectBinLinkedVideoRelinkBinding | null;
	stopProjectBinPreview(): PromiseLike<unknown> | unknown;
	revokeVideoVisual(sourceId: string): PromiseLike<unknown> | unknown;
	relinkLinkedVideoOriginal(
		projectId: string,
		source: VideoSource,
		locatorId: string,
		options: Readonly<RelinkOptions>,
	): PromiseLike<ProjectBinLinkedVideoRelinkBinding> | ProjectBinLinkedVideoRelinkBinding;
	releaseLinkedVideoOriginalLocator(
		reference: ProjectBinLinkedVideoRelinkLocator,
	): PromiseLike<boolean> | boolean;
	activateVideoSource(
		source: VideoSource,
		options: Readonly<{ signal: AbortSignal }>,
	): PromiseLike<unknown> | unknown;
	publish(): void;
}

export interface ProjectBinLinkedVideoRelinkService {
	relinkLinkedVideo(
		clipId: string,
		file: Blob,
		locator: ProjectBinLinkedVideoRelinkLocator,
	): Promise<string>;
	dispose(): Promise<void>;
}

/**
 * Rebind an unavailable Project Bin video without changing project or history.
 * The binding publication is the ownership boundary for the selected locator.
 */
export function createProjectBinLinkedVideoRelinkService(
	dependencies: ProjectBinLinkedVideoRelinkDependencies,
): Readonly<ProjectBinLinkedVideoRelinkService> {
	const settlements = new Set<Promise<void>>();
	const cleanupFailures: unknown[] = [];
	let disposed = false;
	let disposal: Promise<void> | null = null;
	return Object.freeze({ relinkLinkedVideo, dispose });

	function relinkLinkedVideo(
		clipId: string,
		file: Blob,
		locator: ProjectBinLinkedVideoRelinkLocator,
	): Promise<string> {
		const operation = performRelink(clipId, file, locator);
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
	): Promise<string> {
		const candidate = locatorSnapshot(locator);
		let task: EditorTaskScope | null = null;
		let oldBinding: ProjectBinLinkedVideoRelinkBinding | null = null;
		let published = false;
		try {
			if (disposed) throw new DOMException('The linked-video relink service is disposed.', 'AbortError');
			task = dependencies.lifetime.startTask(PROJECT_BIN_LINKED_VIDEO_RELINK_TASK);
			const activeTask = task;
			const project = dependencies.getProject();
			const projectToken = dependencies.captureProject();
			assertWritable(dependencies);
			const source = compoundVideoSource(project, clipId);
			oldBinding = await dependencies.getLinkedVideoOriginalBinding(project.id, source.id);
			assertCurrent(dependencies, activeTask, projectToken);
			assertWritable(dependencies);
			if (!oldBinding) {
				throw new Error('The Project Bin video is not currently bound to a linked original.');
			}
			if (!dependencies.missingSourceIds.has(source.id)) {
				throw new Error('The linked Project Bin video is not currently unavailable.');
			}

			await dependencies.stopProjectBinPreview();
			assertCurrent(dependencies, activeTask, projectToken);
			await dependencies.revokeVideoVisual(source.id);
			assertCurrent(dependencies, activeTask, projectToken);
			assertWritable(dependencies);
			if (!dependencies.missingSourceIds.has(source.id)) {
				throw new Error('The linked Project Bin video became available before relink publication.');
			}

			const rebound = await dependencies.relinkLinkedVideoOriginal(
				project.id,
				source,
				candidate.locatorId,
				Object.freeze({
					expectedBindingToken: oldBinding.bindingToken,
					expectedLocatorRevision: candidate.locatorRevision,
					expectedSnapshot: file,
					assertCanPublish: () => {
						assertCurrent(dependencies, activeTask, projectToken);
						assertWritable(dependencies);
						if (!dependencies.missingSourceIds.has(source.id)) {
							throw new Error('The linked Project Bin video became available before relink publication.');
						}
					},
					signal: activeTask.signal,
				}),
			);
			published = true;
			assertCurrent(dependencies, activeTask, projectToken);
			if (!sameLocator(rebound, candidate)) {
				throw new Error('The linked-video relink published an unexpected locator snapshot.');
			}

			const visual = await dependencies.activateVideoSource(source, { signal: activeTask.signal });
			assertCurrent(dependencies, activeTask, projectToken);
			if (visual === null) throw new Error('The relinked Project Bin video could not be activated.');
			dependencies.missingSourceIds.delete(source.id);
			dependencies.publish();
			return source.id;
		} catch (error) {
			if (!published && !sameLocator(oldBinding, candidate)) {
				try {
					if (!await dependencies.releaseLinkedVideoOriginalLocator(candidate)) {
						throw new Error('The unused linked-video relink locator was not released.');
					}
				} catch (cleanupError) {
					const failure = new AggregateError(
						[error, cleanupError],
						'Linked-video relink and candidate cleanup both failed.',
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
): VideoSource {
	const clips = Array.isArray(project.projectBin?.clips) ? project.projectBin.clips : [];
	const selected = clips.find((clip) => clip.id === clipId);
	if (!selected) throw new Error('The Project Bin item is unavailable.');
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
		throw new Error('The Project Bin item must contain exactly one video source to relink.');
	}
	return [...videos.values()][0] as VideoSource;
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
