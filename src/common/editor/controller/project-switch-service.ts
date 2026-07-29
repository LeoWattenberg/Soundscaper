/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorLifetimeToken } from './lifecycle.ts';
import { SCAPE_OPEN_REQUEST_TASK } from './scape-open-request-service.ts';
import { SCAPE_INSPECTION_TASK } from './scape-inspection-service.ts';
import type {
	ProjectLifecycleCopy,
	ProjectLifecycleHistory,
	ProjectLifecycleLock,
	ProjectLifecycleProject,
	ProjectLifecycleTab,
	ProjectReadOnlyUpdate,
} from './project-lifecycle-types.ts';

export type ProjectSwitchGuard = <Value>(value: PromiseLike<Value> | Value) => Promise<Value>;

export interface ProjectSwitchOptions<History> {
	readonly save?: boolean;
	readonly skipFlush?: boolean;
	readonly readOnly?: boolean;
	readonly readOnlyReason?: string | null;
	readonly history?: History;
}

export interface NewProjectOptions {
	readonly title?: string | null;
	readonly sampleRate?: unknown;
	readonly skipFlush?: boolean;
}

export interface ProjectSwitchState<
	Project extends ProjectLifecycleProject,
	History extends ProjectLifecycleHistory<Project>,
> {
	projectQueue: Promise<void>;
	projectLock: ProjectLifecycleLock | null;
	readOnly: boolean;
	history: History | null;
	selectedTrackId: string | null;
	selectedClipId: string | null;
	clipboard: unknown;
	rackEffectGestures: Map<string, unknown>;
	parametricEqGestures: Map<string, unknown>;
	videoEffectGestures: Map<string, unknown>;
	exportAbort: AbortController | null;
	sampleEditAbort: AbortController | null;
	sampleEditMode: unknown;
	sampleEditAvailable: boolean;
	audacityNoiseProfile: unknown;
	audacityControlTrackId: string | null;
	analysisResult: unknown;
	analysisVisuals: unknown;
	analysisReport: unknown;
	analysisProcessing: boolean;
	contrastSelections: Readonly<{ foreground: unknown; background: unknown }>;
	outputUrl: string | null;
	outputCleanup: (() => PromiseLike<unknown> | unknown) | null;
	exportOutput: unknown;
	missingSourceIds: Set<string>;
	saveState: string;
	projects: readonly unknown[];
}

export interface ProjectSwitchLifetime {
	capture(): EditorLifetimeToken;
	assertActive(token: EditorLifetimeToken): void;
	guard<Value>(value: PromiseLike<Value> | Value, token: EditorLifetimeToken): Promise<Value>;
	cancelTask(name: string): void;
}

export interface ProjectSwitchSession<
	Project extends ProjectLifecycleProject,
	History extends ProjectLifecycleHistory<Project>,
> {
	switchProject(projectId: string): void;
	openProject(project: Project, options: Readonly<{
		history?: History;
		readOnly: boolean;
		readOnlyReason: string | null;
		lockMethod: string;
		metadata: Readonly<{
			intrinsicReadOnly: boolean;
			intrinsicReadOnlyReason: string | null;
		}>;
	}>): void;
	updateProjectMetadata(projectId: string, metadata: Readonly<Record<string, unknown>>): void;
	setProjectReadOnly(projectId: string, update: ProjectReadOnlyUpdate): void;
	getProjectHistory(projectId: string): History;
	clipboardForProject(projectId: string): Readonly<{ descriptor: unknown }> | null;
	markProjectSaved(projectId: string): void;
}

export interface ProjectSwitchServiceRuntime<
	Project extends ProjectLifecycleProject,
	History extends ProjectLifecycleHistory<Project>,
> {
	readonly state: ProjectSwitchState<Project, History>;
	readonly lifetime: ProjectSwitchLifetime;
	readonly projectGeneration: Readonly<{
		invalidate(): void;
		activate(projectId: string): unknown;
	}>;
	readonly copy: ProjectLifecycleCopy;
	readonly getProject: () => Project | null;
	readonly setProject: (project: Project | null) => void;
	readonly createProject: (options: Readonly<{ title: string; sampleRate: number }>) => Project;
	readonly normalizeProjectSampleRate: (sampleRate: unknown) => number;
	readonly createInitialAudioTrackCommand: (options: Readonly<{
		schemaVersion: 2;
		type: 'audio';
		name: string;
		armed: true;
		height: 300;
	}>) => unknown;
	readonly createHistory: (project: Project) => History;
	readonly executeCommand: (history: History, command: unknown) => History;
	readonly migrateProject: (value: unknown) => Readonly<{
		project: Project;
		readOnly: boolean;
	}>;
	readonly assignPreferredInputToTrack: (trackId: string) => void;
	readonly cancelTimedRecording: (options: Readonly<{ publish: false; status: false }>) => unknown;
	readonly cancelRecordingStart: () => unknown;
	readonly cancelPlaybackCachePreparation: () => unknown;
	readonly cancelPlayAtSpeedPreparation: () => unknown;
	readonly stopRecording: () => Promise<unknown>;
	readonly persistActiveSessionUiState: () => void;
	readonly saveNow: () => PromiseLike<unknown> | unknown;
	readonly cancelScheduledSave: () => void;
	readonly stopEngine: () => void;
	readonly cancelEffectPreview: (options: Readonly<{ publish: false }>) => unknown;
	readonly releaseProjectLock: (lock?: ProjectLifecycleLock | null) => Promise<void>;
	readonly acquireProjectLock: (
		projectId: string,
		options: Readonly<{ force: true }>,
	) => Promise<ProjectLifecycleLock>;
	readonly watchProjectLockLoss: (projectId: string, lock: ProjectLifecycleLock) => void;
	readonly scheduleProjectLockRecovery: (projectId: string, lock: ProjectLifecycleLock) => void;
	readonly sessionTab: (projectId: string) => ProjectLifecycleTab<Project, History> | null;
	readonly session: ProjectSwitchSession<Project, History>;
	readonly loadRecordingRouting: (project: Project) => PromiseLike<unknown> | unknown;
	readonly findTrack: (project: Project, trackId: string | null | undefined) => Readonly<{ id: string }> | null;
	readonly findClip: (project: Project, clipId: string | null | undefined) => Readonly<{ id: string }> | null;
	readonly revokeOutputUrl: (url: string) => void;
	readonly revokeVideoVisuals: () => void;
	readonly clearWaveformPcmWindows: () => void;
	readonly loadProjectSources: (project: Project) => PromiseLike<unknown> | unknown;
	readonly retainLiveClipIds: () => void;
	readonly evictUnreferencedSourceCaches: () => void;
	readonly loadEngineProject: (project: Project) => void;
	readonly recordOpenedProject: (projectId: string, guard: ProjectSwitchGuard) => Promise<unknown>;
	readonly saveProject: (project: Project) => Promise<unknown>;
	readonly listProjects: () => Promise<readonly unknown[]>;
	readonly synchronizeMicrophoneMeterTarget: () => void;
	readonly publishProjectState: () => void;
	readonly garbageCollectSources: () => PromiseLike<unknown> | unknown;
	readonly setStatus: (message: string, state: 'error' | 'success') => void;
	readonly isDisposedError: (error: unknown) => boolean;
	readonly clearSourceCaches: () => void;
}

/**
 * Serializes project activation and rejects all post-await work after terminal
 * disposal. Project-scoped tasks are invalidated before any flush or I/O begins.
 */
export function createProjectSwitchService<
	Project extends ProjectLifecycleProject,
	History extends ProjectLifecycleHistory<Project>,
>(runtime: ProjectSwitchServiceRuntime<Project, History>) {
	return Object.freeze({
		newProject,
		openProject,
		performProjectSwitch,
		switchProject,
	});

	async function newProject(options: NewProjectOptions = {}): Promise<void> {
		const title = String(options.title || runtime.copy.untitledProject).trim() || runtime.copy.untitledProject;
		const nextProject = runtime.createProject({
			title,
			sampleRate: runtime.normalizeProjectSampleRate(options.sampleRate),
		});
		const track = runtime.createInitialAudioTrackCommand({
			schemaVersion: 2,
			type: 'audio',
			name: `${runtime.copy.track} 1`,
			armed: true,
			height: 300,
		});
		const history = runtime.executeCommand(runtime.createHistory(nextProject), track);
		await switchProject(history.present, { save: true, skipFlush: options.skipFlush });
		const firstAudioTrack = runtime.getProject()?.tracks.find((candidate) => candidate.type === 'audio');
		if (firstAudioTrack) runtime.assignPreferredInputToTrack(firstAudioTrack.id);
	}

	async function openProject(value: unknown): Promise<void> {
		const loaded = runtime.migrateProject(value);
		const readOnlyReason = loaded.readOnly ? runtime.copy.futureProjectReadOnly : null;
		await switchProject(loaded.project, { readOnly: loaded.readOnly, readOnlyReason });
	}

	function cancelScapeProjectFileTasks(): void {
		runtime.lifetime.cancelTask(SCAPE_OPEN_REQUEST_TASK);
		runtime.lifetime.cancelTask(SCAPE_INSPECTION_TASK);
	}

	function switchProject(
		nextProject: Project,
		options: ProjectSwitchOptions<History> = {},
	): Promise<void> {
		const token = runtime.lifetime.capture();
		cancelScapeProjectFileTasks();
		const operation = runtime.state.projectQueue.then(async () => {
			runtime.lifetime.assertActive(token);
			await performProjectSwitch(nextProject, options, token);
		});
		runtime.state.projectQueue = operation.catch(() => undefined);
		return operation;
	}

	async function performProjectSwitch(
		nextProject: Project,
		options: ProjectSwitchOptions<History> = {},
		token: EditorLifetimeToken = runtime.lifetime.capture(),
	): Promise<void> {
		const guard = <Value>(value: PromiseLike<Value> | Value) => runtime.lifetime.guard(value, token);
		try {
			runtime.projectGeneration.invalidate();
			cancelScapeProjectFileTasks();
			runtime.state.rackEffectGestures.clear();
			runtime.state.parametricEqGestures.clear();
			runtime.state.videoEffectGestures.clear();
			runtime.lifetime.cancelTask('analysis');
			runtime.lifetime.cancelTask('native-project-save');
			runtime.cancelTimedRecording({ publish: false, status: false });
			runtime.cancelRecordingStart();
			runtime.state.exportAbort?.abort();
			runtime.state.exportAbort = null;
			runtime.state.sampleEditAbort?.abort();
			runtime.state.sampleEditMode = null;
			runtime.state.sampleEditAvailable = false;
			runtime.cancelPlaybackCachePreparation();
			runtime.cancelPlayAtSpeedPreparation();
			await guard(runtime.stopRecording().catch(() => undefined));
			runtime.persistActiveSessionUiState();
			const previousProject = runtime.getProject();
			if (!options.skipFlush && previousProject && previousProject.id !== nextProject.id && !runtime.state.readOnly) {
				await guard(runtime.saveNow());
			}
			runtime.cancelScheduledSave();
			runtime.stopEngine();
			runtime.cancelEffectPreview({ publish: false });
			if (!runtime.state.projectLock
				|| runtime.state.projectLock.projectId !== nextProject.id
				|| runtime.state.projectLock.readOnly) {
				await guard(runtime.releaseProjectLock());
				const nextLock = await runtime.acquireProjectLock(nextProject.id, { force: true });
				try {
					runtime.lifetime.assertActive(token);
				} catch (error) {
					await discardLock(nextLock);
					throw error;
				}
				runtime.state.projectLock = nextLock;
			}
			const activeLock = runtime.state.projectLock;
			if (!activeLock) throw new Error('Project activation requires an acquired project lock.');
			runtime.watchProjectLockLoss(nextProject.id, activeLock);
			const lockReadOnly = Boolean(activeLock.readOnly);
			const existingTab = runtime.sessionTab(nextProject.id);
			const existingMetadata = existingTab?.metadata || {};
			const intrinsicReadOnly = options.readOnly == null
				? Boolean(existingMetadata.intrinsicReadOnly)
				: Boolean(options.readOnly);
			const intrinsicReadOnlyReason = options.readOnlyReason
				?? existingMetadata.intrinsicReadOnlyReason
				?? null;
			runtime.state.readOnly = Boolean(intrinsicReadOnly || lockReadOnly);
			if (existingTab) runtime.session.switchProject(nextProject.id);
			else runtime.session.openProject(nextProject, {
				history: options.history,
				readOnly: runtime.state.readOnly,
				readOnlyReason: lockReadOnly ? 'project-lock' : intrinsicReadOnlyReason,
				lockMethod: activeLock.method,
				metadata: { intrinsicReadOnly, intrinsicReadOnlyReason },
			});
			runtime.session.updateProjectMetadata(nextProject.id, {
				intrinsicReadOnly,
				intrinsicReadOnlyReason,
			});
			runtime.session.setProjectReadOnly(nextProject.id, {
				readOnly: runtime.state.readOnly,
				reason: lockReadOnly ? 'project-lock' : intrinsicReadOnlyReason,
				lockMethod: activeLock.method,
			});
			runtime.state.history = runtime.session.getProjectHistory(nextProject.id);
			const activeProject = runtime.state.history.present;
			runtime.setProject(activeProject);
			runtime.projectGeneration.activate(activeProject.id);
			await guard(runtime.loadRecordingRouting(activeProject));
			const tabMetadata = runtime.sessionTab(nextProject.id)?.metadata || {};
			runtime.state.selectedTrackId = runtime.findTrack(activeProject, tabMetadata.selectedTrackId)?.id
				?? activeProject.tracks.find((track) => track.type !== 'label')?.id
				?? activeProject.tracks[0]?.id
				?? null;
			runtime.state.selectedClipId = runtime.findClip(activeProject, tabMetadata.selectedClipId)?.id ?? null;
			runtime.state.clipboard = runtime.session.clipboardForProject(nextProject.id)?.descriptor ?? null;
			resetProjectScopedState();
			if (runtime.state.outputUrl) runtime.revokeOutputUrl(runtime.state.outputUrl);
			runtime.state.outputUrl = null;
			await guard(runtime.state.outputCleanup?.());
			runtime.state.outputCleanup = null;
			runtime.state.exportOutput = null;
			runtime.state.missingSourceIds.clear();
			runtime.revokeVideoVisuals();
			runtime.clearWaveformPcmWindows();
			await guard(runtime.loadProjectSources(activeProject));
			runtime.retainLiveClipIds();
			runtime.evictUnreferencedSourceCaches();
			runtime.loadEngineProject(activeProject);
			await runtime.recordOpenedProject(nextProject.id, guard);
			if (options.save && !runtime.state.readOnly) {
				await guard(runtime.saveProject(activeProject));
				runtime.session.markProjectSaved(activeProject.id);
			}
			runtime.state.saveState = runtime.sessionTab(activeProject.id)?.dirty ? 'dirty' : 'saved';
			runtime.state.projects = Object.freeze(await guard(runtime.listProjects()));
			runtime.synchronizeMicrophoneMeterTarget();
			runtime.publishProjectState();
			await guard(runtime.garbageCollectSources());
			if (lockReadOnly) runtime.setStatus(runtime.copy.projectOpenOtherTab, 'error');
			else if (runtime.state.readOnly) {
				runtime.setStatus(options.readOnlyReason || runtime.copy.projectReadOnly, 'error');
			}
			runtime.scheduleProjectLockRecovery(nextProject.id, activeLock);
		} catch (error) {
			if (runtime.isDisposedError(error)) {
				await runtime.releaseProjectLock().catch(() => undefined);
				runtime.clearSourceCaches();
				runtime.clearWaveformPcmWindows();
				runtime.revokeVideoVisuals();
			}
			throw error;
		}
	}

	function resetProjectScopedState(): void {
		runtime.state.audacityNoiseProfile = null;
		runtime.state.audacityControlTrackId = null;
		runtime.state.analysisResult = null;
		runtime.state.analysisVisuals = null;
		runtime.state.analysisReport = null;
		runtime.state.analysisProcessing = false;
		runtime.state.contrastSelections = { foreground: null, background: null };
	}

	async function discardLock(lock: ProjectLifecycleLock): Promise<void> {
		lock.release();
		await Promise.resolve(lock.finished).catch(() => undefined);
	}
}
