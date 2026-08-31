/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorLifetimeToken } from './lifecycle.ts';
import type { PlaybackProjectService } from './playback-project-service.ts';
import type { ScapeInspectionQuiescence } from './scape-inspection-quiescence.ts';
import type {
	ProjectLifecycleCopy,
	ProjectLifecycleHistory,
	ProjectLifecycleLock,
	ProjectLifecycleProject,
	ProjectLifecycleTab,
	ProjectLifecycleTabMetadata,
	ProjectReadOnlyUpdate,
} from './project-lifecycle-types.ts';
import type { PreparedProjectSourceInputs, PreparedRequiredProjectSources } from './source-lifecycle-service.ts';
import type { SourceChunkProviderReplacement } from './source-chunk-provider-registry.ts';
import type { TakeCycleOpenRecoveryProjectPort } from './take-cycle-open-recovery-app-port.ts';

export type ProjectSwitchGuard = <Value>(value: PromiseLike<Value> | Value) => Promise<Value>;

export interface ProjectFallbackIntegrityAdmission<Project> {
	assertCurrent(project: Project): void;
}

export interface ProjectSwitchOptions<History> {
	readonly save?: boolean;
	readonly skipFlush?: boolean;
	/** Adopt a session history that advanced without changing its stable project ID. */
	readonly adoptSessionRevision?: boolean;
	readonly readOnly?: boolean;
	readonly readOnlyReason?: string | null;
	readonly history?: History;
	/** The native Scape owner is committing this request into its final activation. */
	readonly preserveScapeOpenRequest?: boolean;
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
	readonly signal: AbortSignal;
	capture(): EditorLifetimeToken;
	assertActive(token: EditorLifetimeToken): void;
	guard<Value>(value: PromiseLike<Value> | Value, token: EditorLifetimeToken): Promise<Value>;
	cancelTask(name: string, reason?: unknown): void;
}

export interface ProjectSwitchSession<
	Project extends ProjectLifecycleProject,
	History extends ProjectLifecycleHistory<Project>,
> {
	captureProjectHistory(projectId: string): Readonly<{ history: History; token: unknown }>;
	beginProjectActivation(projectId: string, options: Readonly<{
		expectedHistoryToken?: unknown;
		requireAbsent?: boolean;
	}>): Readonly<{ token: unknown; release(): boolean }>;
	switchProject(projectId: string, options?: Readonly<{ activationToken?: unknown }>): void;
	openProject(project: Project, options: Readonly<{
		activationToken?: unknown;
		history?: History;
		readOnly: boolean;
		readOnlyReason: string | null;
		lockMethod: string;
		metadata: ProjectLifecycleTabMetadata;
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
	readonly productCapabilities: Readonly<Record<string, unknown>>;
	readonly playbackProjectService?: PlaybackProjectService;
	readonly lifetime: ProjectSwitchLifetime;
	readonly scapeInspectionQuiescence: Pick<ScapeInspectionQuiescence, 'beginFence'>;
	readonly projectGeneration: Readonly<{
		invalidate(): void;
		activate(projectId: string): unknown;
	}>;
	readonly copy: ProjectLifecycleCopy;
	readonly getProject: () => Project | null;
	readonly setProject: (project: Project | null) => void;
	readonly createProject: (options: Readonly<{
		title: string;
		sampleRate: number;
		tracks?: Project['tracks'];
	}>) => Project;
	readonly normalizeProjectSampleRate: (sampleRate: unknown) => number;
	readonly createInitialAudioTrackCommand: (options: Readonly<{
		type: 'audio';
		name: string;
		armed: true;
		height: 300;
	}>) => Readonly<{ readonly track: Project['tracks'][number] }>;
	readonly createHistory: (project: Project) => History;
	readonly executeCommand: (history: History, command: unknown) => History;
	readonly loadProject: (value: unknown) => Readonly<{
		project: Project;
		readOnly: boolean;
		intrinsicReadOnly?: boolean;
		reason?: string | null;
	}>;
	readonly verifyProjectFallbackIntegrity: (
		project: Project,
		options: Readonly<{ signal?: AbortSignal }>,
	) => PromiseLike<ProjectFallbackIntegrityAdmission<Project>> | ProjectFallbackIntegrityAdmission<Project>;
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
	readonly stopProjectBinPreview: (options: Readonly<{ dispose: true }>) => PromiseLike<unknown> | unknown;
	readonly disposeRenderEngines: () => PromiseLike<void> | void;
	readonly beginSourceChunkProviderReplacement: () => SourceChunkProviderReplacement;
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
	readonly restoreProjectSelection: (project: Project, metadata: ProjectLifecycleTabMetadata) => void;
	readonly revokeOutputUrl: (url: string) => void;
	readonly revokeVideoVisuals: () => PromiseLike<void> | void;
	readonly clearWaveformPcmWindows: () => void;
	readonly loadProjectSources: (project: Project, options?: Readonly<{
		readonly excludedAudioSourceIds?: readonly string[];
		readonly onlyRequiredAudioSources?: boolean;
		readonly requiredAudioSourceIds?: readonly string[];
		readonly requiredVideoSourceIds?: readonly string[];
		readonly signal?: AbortSignal;
	}>) => PromiseLike<ReadonlyMap<string, unknown>> | ReadonlyMap<string, unknown>;
	readonly prepareRequiredProjectSources: (project: Project, options: Readonly<{
		readonly requiredAudioSourceIds: readonly string[];
		readonly signal?: AbortSignal;
	}>) => PromiseLike<PreparedRequiredProjectSources> | PreparedRequiredProjectSources;
	readonly retainLiveClipIds: () => void;
	readonly evictUnreferencedSourceCaches: () => void;
	readonly loadEngineProject: (
		project: Project,
		transientSourceBuffers?: unknown,
		preparedSources?: PreparedProjectSourceInputs,
	) => PromiseLike<unknown> | unknown;
	readonly openRecovery?: Readonly<TakeCycleOpenRecoveryProjectPort>;
	readonly recordOpenedProject: (projectId: string, guard: ProjectSwitchGuard) => Promise<unknown>;
	readonly maintainOpenedProject: (
		projectId: string,
		isCurrentWritable: () => boolean,
	) => PromiseLike<unknown> | unknown;
	readonly createProjectIfAbsent?: (project: Project) => PromiseLike<Project | null> | Project | null;
	readonly saveProject: (project: Project) => Promise<unknown>;
	readonly listProjects: () => Promise<readonly unknown[]>;
	readonly synchronizeMicrophoneMeterTarget: () => void;
	readonly publishProjectState: () => void;
	readonly garbageCollectSources: () => PromiseLike<unknown> | unknown;
	readonly setStatus: (message: string, state: 'error' | 'success') => void;
	readonly isDisposedError: (error: unknown) => boolean;
	readonly clearSourceCaches: () => PromiseLike<void> | void;
}
