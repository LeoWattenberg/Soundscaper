/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../commands/protocol.ts';
import type { ProjectFlushOptions } from './project-save-service.ts';
import {
	assertEditorCommandCapabilities,
	type EditorCommandCapabilities,
} from './command-capability-policy.ts';

export interface MutationTrack {
	readonly id: string;
}

export interface MutationProject<Track extends MutationTrack = MutationTrack> {
	readonly id: string;
	readonly tracks: readonly Track[];
	readonly clips: readonly Readonly<{ readonly id: string }>[];
}

export interface MutationHistory<Project extends MutationProject> {
	readonly present: Project;
}

export interface MutationRecordingRouting {
	readonly routes: Readonly<Record<string, unknown>>;
}

export interface ProjectMutationState<
	Project extends MutationProject,
	History extends MutationHistory<Project>,
	Routing extends MutationRecordingRouting,
> {
	readOnly: boolean;
	takeCycleRecovery?: unknown;
	takeCycleRecoveryInspecting?: boolean;
	history: History | null;
	selectedTrackId: string | null;
	selectedClipId: string | null;
	projectBinPreview: unknown;
	recordingRouting: Routing;
	recordingRouteHealth: Record<string, string>;
}

interface MutationLifetime<LifetimeToken> {
	capture(): LifetimeToken;
	assertActive(token?: LifetimeToken): void;
}

interface ProjectRetentionPort<History> {
	compactLiveSourceState(dirty?: boolean | null): unknown;
	retainLiveClipIds(): void;
	synchronizeLiveHistory(history: History): History;
}

interface ProjectPublisherPort {
	publishProjectState(): void;
}

interface ProjectSavePort {
	scheduleAutosave(): boolean;
	flushProject(options?: ProjectFlushOptions): PromiseLike<unknown> | unknown;
}

export interface CommitSelection {
	readonly selectTrackId?: string | null;
	readonly selectClipId?: string | null;
}

export interface ProjectChangedOptions {
	readonly skipPlaybackEngine?: boolean;
}

export interface ProjectMutationServiceDependencies<
	Project extends MutationProject<Track>,
	History extends MutationHistory<Project>,
	Routing extends MutationRecordingRouting,
	ProjectToken,
	LifetimeToken = Readonly<{ readonly generation: number }>,
	Track extends MutationTrack = MutationTrack,
> {
	readonly lifetime: MutationLifetime<LifetimeToken>;
	readonly state: ProjectMutationState<Project, History, Routing>;
	readonly productName: string;
	readonly capabilities: EditorCommandCapabilities;
	readonly projectReadOnlyMessage: string;
	readonly assertEditingAllowed: () => void;
	readonly getProject: () => Project | null;
	readonly setProject: (project: Project | null) => void;
	readonly getHistory: () => History | null;
	readonly setHistory: (history: History) => void;
	readonly executeEditorCommand: (history: History, command: AudioEditorCommand) => History;
	readonly applyEditorCommand: (project: Project, command: AudioEditorCommand) => Project;
	readonly retention: ProjectRetentionPort<History>;
	readonly publisher: ProjectPublisherPort;
	readonly saves: ProjectSavePort;
	readonly stopProjectBinPreview: () => unknown;
	readonly clearWaveformPcmWindows: () => void;
	readonly normalizeRecordingRouting: (routing: Routing, tracks: readonly Track[]) => Routing;
	readonly persistRecordingRouting: () => Promise<unknown>;
	readonly findClip: (project: Project, clipId: string) => Readonly<{ id: string }> | null;
	readonly findTrack: (project: Project, trackId: string) => Track | null;
	readonly synchronizeMicrophoneMeterTarget: () => void;
	readonly synchronizeAnnotationFocus: () => void;
	readonly getPlaybackState: () => string;
	readonly projectHasTimePitchClips: (project: Project) => boolean;
	readonly beginPlaybackCachePreparation: (project: Project) => PromiseLike<unknown>;
	readonly applyProjectToPlaybackEngine: (project: Project) => PromiseLike<unknown>;
	readonly captureProject: (projectId: string) => ProjectToken;
	readonly assertProject: (token: ProjectToken) => void;
	readonly handleError: (error: unknown) => void;
	readonly isExpectedCancellation: (error: unknown) => boolean;
}

export interface ProjectMutationService<Project extends MutationProject> {
	commit(command: AudioEditorCommand, selection?: CommitSelection, options?: ProjectChangedOptions): Project;
	updateSelection(command: AudioEditorCommand): Project;
	projectChanged(options?: ProjectChangedOptions): void;
	scheduleAutosave(): boolean;
	saveNow(): Promise<unknown>;
	flushProject(options?: ProjectFlushOptions): Promise<unknown>;
}

/** Coordinates the one synchronous command/history/project publication path. */
export function createProjectMutationService<
	Project extends MutationProject<Track>,
	History extends MutationHistory<Project>,
	Routing extends MutationRecordingRouting,
	ProjectToken,
	LifetimeToken = Readonly<{ readonly generation: number }>,
	Track extends MutationTrack = MutationTrack,
>(
	dependencies: ProjectMutationServiceDependencies<
		Project, History, Routing, ProjectToken, LifetimeToken, Track
	>,
): Readonly<ProjectMutationService<Project>> {
	return Object.freeze({
		commit,
		updateSelection,
		projectChanged,
		scheduleAutosave,
		saveNow,
		flushProject,
	});

	function commit(
		command: AudioEditorCommand,
		selection: CommitSelection = {},
		options: ProjectChangedOptions = {},
	): Project {
		dependencies.lifetime.assertActive();
		assertWritable();
		assertEditorCommandCapabilities(command, dependencies.capabilities, dependencies.productName);
		const history = requireHistory();
		const nextHistory = dependencies.executeEditorCommand(history, command);
		dependencies.setHistory(nextHistory);
		dependencies.state.history = nextHistory;
		dependencies.setProject(nextHistory.present);
		if (Object.hasOwn(selection, 'selectTrackId')) {
			dependencies.state.selectedTrackId = selection.selectTrackId ?? null;
		}
		if (Object.hasOwn(selection, 'selectClipId')) {
			dependencies.state.selectedClipId = selection.selectClipId ?? null;
		}
		projectChanged(options);
		return requireProject();
	}

	function updateSelection(command: AudioEditorCommand): Project {
		dependencies.lifetime.assertActive();
		assertWritable();
		assertEditorCommandCapabilities(command, dependencies.capabilities, dependencies.productName);
		const history = requireHistory();
		const nextProject = dependencies.applyEditorCommand(history.present, command);
		const nextHistory = dependencies.retention.synchronizeLiveHistory({ ...history, present: nextProject });
		dependencies.setHistory(nextHistory);
		dependencies.state.history = nextHistory;
		dependencies.setProject(nextHistory.present);
		dependencies.synchronizeAnnotationFocus();
		dependencies.publisher.publishProjectState();
		return nextHistory.present;
	}

	function projectChanged(options: ProjectChangedOptions = {}): void {
		dependencies.lifetime.assertActive();
		if (dependencies.state.projectBinPreview) void dependencies.stopProjectBinPreview();
		dependencies.clearWaveformPcmWindows();
		dependencies.retention.compactLiveSourceState(true);
		dependencies.retention.retainLiveClipIds();
		const project = requireProject();
		const normalizedRouting = dependencies.normalizeRecordingRouting(
			dependencies.state.recordingRouting,
			project.tracks,
		);
		if (JSON.stringify(normalizedRouting) !== JSON.stringify(dependencies.state.recordingRouting)) {
			dependencies.state.recordingRouting = normalizedRouting;
			for (const trackId of Object.keys(dependencies.state.recordingRouteHealth)) {
				if (!normalizedRouting.routes[trackId]) delete dependencies.state.recordingRouteHealth[trackId];
			}
			void dependencies.persistRecordingRouting().catch(() => undefined);
		}
		if (dependencies.state.selectedClipId
			&& !dependencies.findClip(project, dependencies.state.selectedClipId)) {
			dependencies.state.selectedClipId = null;
		}
		if (dependencies.state.selectedTrackId
			&& !dependencies.findTrack(project, dependencies.state.selectedTrackId)) {
			dependencies.state.selectedTrackId = project.tracks[0]?.id ?? null;
		}
		dependencies.synchronizeMicrophoneMeterTarget();
		dependencies.synchronizeAnnotationFocus();
		if (!options.skipPlaybackEngine) queuePlaybackProject(project);
		dependencies.publisher.publishProjectState();
		dependencies.saves.scheduleAutosave();
	}

	function scheduleAutosave(): boolean {
		dependencies.lifetime.assertActive();
		return dependencies.saves.scheduleAutosave();
	}

	async function saveNow(): Promise<unknown> {
		dependencies.lifetime.assertActive();
		return dependencies.saves.flushProject();
	}

	async function flushProject(options: ProjectFlushOptions = {}): Promise<unknown> {
		dependencies.lifetime.assertActive();
		return dependencies.saves.flushProject(options);
	}

	function queuePlaybackProject(project: Project): void {
		const lifetimeToken = dependencies.lifetime.capture();
		const projectToken = dependencies.captureProject(project.id);
		const prepare = dependencies.getPlaybackState() === 'playing'
			&& dependencies.projectHasTimePitchClips(project);
		void applyWhenCurrent().catch((error: unknown) => {
			if (!dependencies.isExpectedCancellation(error)) dependencies.handleError(error);
		});

		async function applyWhenCurrent(): Promise<void> {
			if (prepare) await dependencies.beginPlaybackCachePreparation(project);
			dependencies.lifetime.assertActive(lifetimeToken);
			dependencies.assertProject(projectToken);
			if (dependencies.getProject() !== project) return;
			await dependencies.applyProjectToPlaybackEngine(project);
			dependencies.lifetime.assertActive(lifetimeToken);
			dependencies.assertProject(projectToken);
		}
	}

	function assertWritable(): void {
		dependencies.assertEditingAllowed();
		if (dependencies.state.readOnly) throw new Error(dependencies.projectReadOnlyMessage);
		if (dependencies.state.takeCycleRecovery || dependencies.state.takeCycleRecoveryInspecting) {
			throw new Error('Resolve pending take cycle recovery before editing.');
		}
	}

	function requireHistory(): History {
		const history = dependencies.getHistory();
		if (!history) throw new Error('An active project history is required.');
		return history;
	}

	function requireProject(): Project {
		const project = dependencies.getProject();
		if (!project) throw new Error('An active project is required.');
		return project;
	}
}
