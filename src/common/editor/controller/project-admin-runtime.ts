/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperCaptureAdminInterlockLease, FramescaperCaptureAdminOperationRequest } from './framescaper-capture-admin-interlock.ts';
import type { ProjectLinkedOriginalSourceReference } from '../storage/project-publication-options.ts';
import type { ProjectFlushOptions } from './project-save-service.ts';

type Awaitable<Value> = Value | PromiseLike<Value>;

export interface AdminProject {
	readonly id: string;
	readonly title?: unknown;
	readonly revision?: unknown;
}

export interface AdminHistory<Project extends AdminProject> {
	readonly present: Project;
}

export interface AdminSessionTab<Project extends AdminProject, History extends AdminHistory<Project>> {
	readonly projectId: string;
	readonly history: History;
	readonly metadata?: Readonly<Record<string, unknown>>;
	readonly dirty?: boolean;
	readonly readOnly?: boolean;
}

export interface AdminCloseOptions { readonly discard?: boolean }
export interface AdminCloseResult {
	readonly closed: boolean;
	readonly reason?: string | null;
	readonly activeProjectId?: string | null;
	readonly releasedSourceIds?: readonly string[];
}

interface SourceCache {
	keys(): IterableIterator<string>;
	delete(sourceId: string): unknown;
	clear(): void;
}

interface AdminState<Project extends AdminProject, History extends AdminHistory<Project>> {
	disposed: boolean;
	readOnly: boolean;
	readonly takeCycleRecovery?: unknown;
	readonly takeCycleRecoveryInspecting?: boolean;
	readonly projectLock?: Readonly<{ projectId: string; readOnly: boolean }> | null;
	history: History | null;
	projects: readonly AdminProject[];
	selectedTrackId: string | null;
	selectedClipId: string | null;
	selectedAnnotationId: string | null;
	readonly missingSourceIds: Set<string>;
	sourceGcTimer: number;
}

/** Exact capabilities the administration owner uses; stored copies enter through openProject. */
export interface ProjectAdminServiceRuntime<
	Project extends AdminProject = AdminProject,
	History extends AdminHistory<Project> = AdminHistory<Project>,
> {
	readonly beginCaptureInterlockedAdminOperation?: (
		request: Readonly<FramescaperCaptureAdminOperationRequest>,
	) => Readonly<FramescaperCaptureAdminInterlockLease>;
	cancelPlaybackCachePreparation(): unknown;
	clearScheduledTimer(timer: number): void;
	clearWaveformPcmWindows(): void;
	readonly clipTimePitchCache: Readonly<{
		retainClipIds?(clipIds: Iterable<string>): unknown;
		clear?(): Awaitable<unknown>;
	}>;
	commit(command: Readonly<{ type: 'project/rename'; title: string }>): unknown;
	readonly copy: Readonly<{
		projectReadOnly: string; projectNotFound: string;
		projectTitleRequired: string; projectCopySuffix: string;
	}>;
	currentTimeMs(): number;
	disposeRenderEngines(): Awaitable<void>;
	editorHistoryProjects(history: History): readonly Project[];
	readonly engine: Readonly<{ stop(): unknown }>;
	evictUnreferencedSourceCaches(buffers: SourceCache, peaks: SourceCache, retainedIds: Set<string>): unknown;
	flushProject(options?: ProjectFlushOptions): Awaitable<unknown>;
	getProject(): Project | null;
	getRecordingRouting(): unknown;
	handleError(error: unknown): unknown;
	liveSessionClipIds(): Set<string>;
	liveSessionLinkedOriginalSourceReferences(): readonly ProjectLinkedOriginalSourceReference[];
	liveSessionSourceIds(): Set<string>;
	newProject(options: Readonly<{ skipFlush: boolean }>): Awaitable<unknown>;
	openProject(project: unknown): Awaitable<unknown>;
	persistSetting(key: string, value: unknown, options: Readonly<{ policy: 'required' }>): Awaitable<unknown>;
	readonly projectSaveService: Readonly<{
		suspend(): void; resume(): void;
		suspendProject(projectId: string): void; resumeProject(projectId: string): void;
		retireProjectSaves(projectId: string): void;
		drain(): Awaitable<unknown>;
		readonly pendingSnapshots: Iterable<Project>;
	}>;
	readonly projectGeneration: Readonly<{ activate(projectId: string): unknown; invalidate(): void }>;
	readonly projectMaintenanceRuntime?: Readonly<{
		reconcileAndCollectStorageRoots(request: Readonly<{
			currentProject: unknown; pendingSaveSnapshots: unknown;
		}>): PromiseLike<Readonly<{ storageRoots: readonly string[] }>>;
	}>;
	readonly projectSessionService: Readonly<{ clearRecentProjects(): Awaitable<unknown> }>;
	publishDocumentSnapshot(): void;
	recordingRoutingSettingKey(projectId: string): string;
	releaseProjectLock(): Awaitable<unknown>;
	revokeVideoVisuals(): Awaitable<unknown>;
	saveNow(): Awaitable<unknown>;
	scheduleTimer(callback: () => void, delayMs: number): number;
	readonly sessionController: Readonly<{
		getSnapshot(): Readonly<{ tabs: readonly AdminSessionTab<Project, History>[] }>;
		captureProjectHistory(projectId: string): Readonly<{ token: unknown; history: History }>;
		beginProjectActivation(projectId: string, options: Readonly<{ expectedHistoryToken: unknown }>): Readonly<{ release(): boolean }>;
		markProjectSaved(projectId: string): unknown;
		closeProject(projectId: string, options: Readonly<{ force: true }>): AdminCloseResult;
		clearClipboard(): unknown;
	}>;
	sessionTab(projectId: string): AdminSessionTab<Project, History> | null;
	setProject(project: Project | null): void;
	readonly sourceBuffers: SourceCache;
	readonly sourceChunkProviders: SourceCache & { drain?(): Awaitable<void> };
	readonly sourcePeaks: SourceCache;
	readonly state: AdminState<Project, History>;
	stopProjectBinPreview(options: Readonly<{ dispose: true }>): Awaitable<unknown>;
	stopRecording(): Awaitable<unknown>;
	readonly store: Readonly<{
		listProjects(): Awaitable<readonly AdminProject[]>;
		prepareProjectHandoff?(project: Project): Awaitable<unknown>;
		saveProject(project: Project, options: Readonly<{
			protectedLinkedOriginalSourceReferences: readonly ProjectLinkedOriginalSourceReference[];
		}>): Awaitable<unknown>;
		duplicateProject(projectId: string, options: Readonly<{ title: string }>): Awaitable<AdminProject>;
		deleteProject(projectId: string): Awaitable<unknown>;
		clear(): Awaitable<unknown>;
		preservesProjectsOnClear?(): boolean;
		pruneUnreferencedSources?(options: Readonly<{
			protectedProjects: readonly Project[]; protectedSourceIds: Set<string>;
		}>): Awaitable<Readonly<{ deletedSourceIds?: readonly string[]; nextEligibleAt?: number | null }>>;
	}>;
	switchProject(project: Project, options: Readonly<{ skipFlush: boolean }>): Awaitable<unknown>;
}
