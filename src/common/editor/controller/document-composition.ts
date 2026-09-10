/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAddClipCommand, createAddTrackCommand } from '../commands.js';
import { createHistorySourceCompactor } from '../history-source-compaction.ts';
import { createStableId, findClip, findTrack } from '../project.js';
import {
	compactProjectSourceMetadata,
	editorHistoryProjects,
	evictUnreferencedSourceCaches,
} from '../retention.js';
import { cloneVideoEffects } from '../video-effects.js';
import type {
	DocumentCompositionDependencies,
	DocumentHistory,
	DocumentProject,
	DocumentSessionTab,
} from './document-composition-types.ts';
import { isEditorDisposedError, type EditorLifetimeToken, type EditorProjectToken } from './lifecycle.ts';
import { createProjectMutationService, type MutationTrack } from './project-mutation-service.ts';
import { createProjectRetentionService } from './project-retention-service.ts';
import { createProjectSaveService } from './project-save-service.ts';
import { createProjectSessionService } from './project-session-service.ts';
import { createProjectViewService } from './project-view-service.ts';
import { createRegularIntervalAnnotationController } from './regular-interval-annotation-controller.ts';
import { createTimelineAnnotationService } from './timeline-annotation-service.ts';
import { createTrackDuplicationService } from './track-duplication-service.ts';
import { createTrackFolderService } from './track-folder-service.ts';

export type {
	DocumentCompositionCopy,
	DocumentCompositionDependencies,
	DocumentCompositionState,
	DocumentCompositionStore,
	DocumentHistory,
	DocumentProject,
	DocumentSessionPort,
	DocumentSessionTab,
} from './document-composition-types.ts';

type Mutation = ReturnType<typeof createProjectMutationService<
	DocumentProject, DocumentHistory, EditorProjectToken, EditorLifetimeToken, MutationTrack
>>;

/**
 * Build the document domain: the session tabs and their selection memory,
 * project saves and autosave, source retention across the undo history, the
 * view publisher, timeline annotations, track folders, the mutation service
 * that commits commands, and track duplication. Retention is built before
 * saves so the save path can ask it which linked originals stay protected;
 * annotations are built before mutation and reach its selection update
 * through a closure, because mutation synchronises annotation focus in turn.
 */
export function createDocumentComposition(dependencies: DocumentCompositionDependencies) {
	const { state, copy, lifetime, projectRuntime, session, store, engine, sources } = dependencies;
	const captureProject = (projectId: string) => dependencies.projectGeneration.capture(projectId);
	const assertProject = (token: ReturnType<typeof captureProject>) => dependencies.projectGeneration.assertCurrent(token);
	const requireProject = (): DocumentProject => {
		const project = dependencies.getProject();
		if (!project) throw new Error('The document services require an open project.');
		return project;
	};
	let mutation: Mutation | null = null;
	const requireMutation = (): Mutation => {
		if (!mutation) throw new Error('The mutation service is not composed yet.');
		return mutation;
	};

	const projectSession = createProjectSessionService<DocumentProject, DocumentSessionTab>({
		productId: dependencies.product.id,
		recentProjectsSettingKey: dependencies.settingKeys.recentProjects,
		lastProjectSettingKey: dependencies.settingKeys.lastProject,
		getRecentProjectIds: () => state.recentProjectIds,
		setRecentProjectIds: (projectIds) => { state.recentProjectIds = projectIds; },
		getActiveProjectId: () => dependencies.getProject()?.id ?? null,
		state,
		findTrack,
		findClip,
		getTabs: () => session.getSnapshot().tabs,
		updateProjectMetadata: (projectId, metadata) => session.updateProjectMetadata(projectId, metadata),
		loadSetting: (key, fallback) => store.loadSetting(key, fallback),
		persistSetting: dependencies.persistSetting,
		publish: dependencies.publishDocumentSnapshot,
	});
	const { sessionTab } = projectSession;
	const retention = createProjectRetentionService<DocumentProject, DocumentHistory>({
		state,
		getProject: dependencies.getProject,
		setProject: dependencies.setProject,
		compactHistory: createHistorySourceCompactor<DocumentProject>((project, preserveSourceIds) => (
			compactProjectSourceMetadata(project, { preserveSourceIds })
		)),
		sessionTab,
		updateProjectHistory: (projectId, history, updateOptions) => (
			session.updateProjectHistory(projectId, history, updateOptions)
		),
		getSourceReferenceCounts: () => session.getSourceReferenceCounts(),
		getSessionTabs: () => session.getSnapshot().tabs,
		editorHistoryProjects,
		allProjectClips: (project) => sources.projectVisual.allProjectClips(project),
		clipCache: dependencies.timePitchCache,
		getProtectedSourceIds: () => dependencies.protectedSourceIds,
		sourceBuffers: dependencies.sourceBuffers,
		sourcePeaks: dependencies.sourcePeaks,
		evictSourceCaches: evictUnreferencedSourceCaches,
	});
	const saves = createProjectSaveService<DocumentProject>({
		getProject: dependencies.getProject,
		hasHistory: () => Boolean(dependencies.getHistory()),
		hasUnsavedProjectChanges: () => {
			const project = dependencies.getProject();
			return Boolean(project && sessionTab(project.id)?.dirty);
		},
		isReadOnly: () => state.readOnly || Boolean(state.takeCycleRecovery || state.takeCycleRecoveryInspecting),
		cloneProject: projectRuntime.cloneProject,
		prepareSnapshot: dependencies.prepareProjectSnapshot
			? async (snapshot, purpose) => {
				await dependencies.prepareProjectSnapshot?.(purpose, snapshot);
				const project = dependencies.getProject();
				if (!project || project.id !== snapshot.id) throw new Error('The active project changed during save preparation.');
				return projectRuntime.cloneProject(project);
			}
			: undefined,
		admitProjectPublication: (bytes) => dependencies.preflightStorage(bytes, 'project'),
		collectProtectedLinkedOriginalSourceReferences: () => retention.liveSessionLinkedOriginalSourceReferences(),
		saveProject: (snapshot, saveOptions) => store.saveProject(snapshot, saveOptions),
		persistActiveProjectId: async (projectId) => {
			await dependencies.persistSetting(dependencies.settingKeys.lastProject, projectId);
			if (dependencies.product.id === 'soundscaper') await dependencies.persistSetting('last-project-id', projectId);
		},
		isCurrentProject: (projectId) => dependencies.getProject()?.id === projectId,
		hasSessionTab: (projectId) => Boolean(sessionTab(projectId)),
		markProjectSaved: (projectId) => session.markProjectSaved(projectId),
		publish: (saveState) => { state.saveState = saveState; dependencies.publishDocumentSnapshot(); },
		garbageCollect: dependencies.garbageCollectSources,
		refreshStorageUsage: dependencies.refreshStorageUsage,
		handleError: dependencies.handleError,
		scheduleTimer: dependencies.scheduleTimer,
		clearTimer: dependencies.clearTimer,
	});
	const view = createProjectViewService<DocumentProject>({
		lifetime,
		state,
		getProject: dependencies.getProject,
		projectDurationFrames: dependencies.projectDurationFrames,
		editorTimelineDurationFrames: dependencies.editorTimelineDurationFrames,
		projectSampleRate: dependencies.projectSampleRate,
		maximumPixelsPerSecond: dependencies.maximumPixelsPerSecond,
		synchronizeAutomaticSampleEditMode: dependencies.synchronizeAutomaticSampleEditMode,
		updatePlayhead: dependencies.updatePlayhead,
		publishDocumentSnapshot: dependencies.publishDocumentSnapshot,
		editingBlocked: dependencies.editingBlocked,
		commit: (command) => requireMutation().commit(command),
		getEnginePositionFrames: () => engine.getPositionFrames(),
	});
	const timelineAnnotation = createTimelineAnnotationService({
		lifetime,
		state,
		getProject: dependencies.getProject,
		editingBlocked: dependencies.editingBlocked,
		createId: createStableId,
		getPositionFrames: () => engine.getPositionFrames(),
		commit: (command) => requireMutation().commit(command),
		updateSelection: (command) => requireMutation().updateSelection(command),
		publishProjectState: () => view.publishProjectState(),
	});
	const regularIntervalAnnotation = createRegularIntervalAnnotationController({
		getProject: requireProject,
		editingBlocked: dependencies.editingBlocked,
		createId: createStableId,
		commit: (command) => requireMutation().commit(command),
	});
	const trackFolder = createTrackFolderService({
		lifetime,
		getProject: dependencies.getProject,
		editingBlocked: dependencies.editingBlocked,
		createId: createStableId,
		commit: (command) => requireMutation().commit(command),
		publishProjectState: () => view.publishProjectState(),
	});
	mutation = createProjectMutationService<
		DocumentProject, DocumentHistory, EditorProjectToken, EditorLifetimeToken, MutationTrack
	>({
		lifetime,
		state,
		productName: dependencies.product.name,
		capabilities: dependencies.capabilities,
		projectReadOnlyMessage: copy.projectReadOnly,
		assertEditingAllowed: dependencies.assertEditingAllowed,
		getProject: dependencies.getProject,
		setProject: dependencies.setProject,
		getHistory: dependencies.getHistory,
		setHistory: dependencies.setHistory,
		executeEditorCommand: projectRuntime.executeCommand,
		collapseEditorHistory: projectRuntime.collapseHistory,
		rollbackEditorHistory: projectRuntime.rollbackHistory,
		applyEditorCommand: projectRuntime.applyCommand,
		retention,
		publisher: view,
		saves,
		stopProjectBinPreview: dependencies.stopProjectBinPreview,
		clearWaveformPcmWindows: () => sources.sourceLifecycle.clearWaveformPcmWindows(),
		reconcileRecordingRouting: dependencies.reconcileRecordingRouting,
		persistRecordingRouting: dependencies.persistRecordingRouting,
		findClip,
		findTrack,
		synchronizeMicrophoneMeterTarget: dependencies.synchronizeMicrophoneMeterTarget,
		synchronizeAnnotationFocus: () => timelineAnnotation.synchronizeFocus(false),
		getPlaybackState: () => engine.getState().state,
		getPlayheadFrame: () => engine.getPositionFrames(),
		seekPlayhead: (frame) => engine.seek(frame),
		projectHasTimePitchClips: (project) => sources.timePitchCaches.projectHasTimePitchClips(project),
		beginPlaybackCachePreparation: (project) => sources.timePitchCaches.beginPlaybackCachePreparation(project),
		applyProjectToPlaybackEngine: (project) => sources.playbackApply.apply(project),
		captureProject,
		assertProject,
		handleError: dependencies.handleError,
		isExpectedCancellation: (error) => (
			isEditorDisposedError(error) || (error as { name?: unknown } | null)?.name === 'AbortError'
		),
	});
	const trackDuplication = createTrackDuplicationService({
		lifetime,
		copySuffix: copy.projectCopySuffix,
		editingBlocked: dependencies.editingBlocked,
		getProject: requireProject,
		createId: createStableId,
		findClip,
		cloneVideoEffects,
		createAddTrackCommand,
		createAddClipCommand,
		prepareTrackDuplicateCarrier: projectRuntime.prepareTrackDuplicateCarrier,
		commit: (command, selection) => requireMutation().commit(command, selection),
	});

	return Object.freeze({
		session: projectSession,
		sessionTab,
		retention,
		saves,
		view,
		timelineAnnotation,
		regularIntervalAnnotation,
		trackFolder,
		mutation,
		trackDuplication,
	});
}

export type DocumentComposition = ReturnType<typeof createDocumentComposition>;
