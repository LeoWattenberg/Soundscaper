/* SPDX-License-Identifier: AGPL-3.0-only */

/* eslint-disable @typescript-eslint/no-explicit-any -- Explicit legacy ports keep the project-administration composition seam typo-safe. */

type LegacyPort = (...args: any[]) => any;

interface SourceChunkProviderMap extends Map<string, any> {
	drain?(): PromiseLike<void> | void;
}

export interface ProjectAdminServiceRuntime {
	readonly cancelPlaybackCachePreparation: LegacyPort;
	readonly clearScheduledTimer: LegacyPort;
	readonly clearWaveformPcmWindows: LegacyPort;
	readonly clipTimePitchCache: any;
	readonly commit: LegacyPort;
	readonly copy: any;
	readonly currentTimeMs: LegacyPort;
	readonly disposeRenderEngines: () => PromiseLike<void> | void;
	readonly editorHistoryProjects: LegacyPort;
	readonly engine: any;
	readonly evictUnreferencedSourceCaches: LegacyPort;
	readonly flushProject: LegacyPort;
	readonly getProject: LegacyPort;
	readonly handleError: LegacyPort;
	readonly liveSessionClipIds: LegacyPort;
	readonly liveSessionLinkedOriginalSourceReferences: LegacyPort;
	readonly liveSessionSourceIds: LegacyPort;
	readonly newProject: LegacyPort;
	readonly openProject: LegacyPort;
	readonly persistSetting: LegacyPort;
	readonly projectSaveService: any;
	readonly projectMaintenanceRuntime?: Readonly<{
		reconcileAndCollectStorageRoots(request: Readonly<{
			currentProject: unknown;
			pendingSaveSnapshots: unknown;
		}>): PromiseLike<Readonly<{ storageRoots: readonly string[] }>>;
	}>;
	readonly projectSessionService: any;
	readonly publishDocumentSnapshot: LegacyPort;
	readonly recordingRoutingSettingKey: LegacyPort;
	readonly releaseProjectLock: LegacyPort;
	readonly revokeVideoVisuals: LegacyPort;
	readonly saveNow: LegacyPort;
	readonly scheduleTimer: LegacyPort;
	readonly sessionController: any;
	readonly sessionTab: LegacyPort;
	readonly setProject: LegacyPort;
	readonly sourceBuffers: any;
	readonly sourceChunkProviders: SourceChunkProviderMap;
	readonly sourcePeaks: Map<string, any>;
	readonly state: any;
	readonly stopProjectBinPreview: (options: Readonly<{ dispose: true }>) => PromiseLike<unknown> | unknown;
	readonly stopRecording: LegacyPort;
	readonly store: any;
	readonly switchProject: LegacyPort;
}

export function createProjectAdminService(runtime: ProjectAdminServiceRuntime) {
	const {
		cancelPlaybackCachePreparation, clearScheduledTimer, clearWaveformPcmWindows,
		clipTimePitchCache, commit, copy, currentTimeMs, disposeRenderEngines, editorHistoryProjects, engine,
		evictUnreferencedSourceCaches, flushProject, getProject, handleError,
		liveSessionClipIds, liveSessionLinkedOriginalSourceReferences,
		liveSessionSourceIds, newProject, openProject, persistSetting,
		projectSaveService, projectMaintenanceRuntime, projectSessionService, publishDocumentSnapshot,
		recordingRoutingSettingKey, releaseProjectLock, revokeVideoVisuals, saveNow,
		scheduleTimer, sessionController, sessionTab, setProject, sourceBuffers,
		sourceChunkProviders, sourcePeaks, state, stopProjectBinPreview, stopRecording, store, switchProject,
	} = runtime;
	const recoveryBlocked = () => Boolean(
		state.takeCycleRecovery || state.takeCycleRecoveryInspecting,
	);

	async function listProjects() {
		await saveNow();
		state.projects = Object.freeze(await store.listProjects());
		publishDocumentSnapshot();
		return state.projects;
	}

	async function prepareProjectHandoff() {
		if (recoveryBlocked()) throw new Error(copy.projectReadOnly);
		const project = getProject();
		if (!project) throw new Error(copy.projectNotFound);
		const metadata = sessionTab(project.id)?.metadata;
		const featureRequirementReadOnly = Boolean(
			state.readOnly
			&& metadata?.declaredReadOnly === false
			&& metadata.intrinsicReadOnly === true
			&& metadata.featureRequirementsReadOnly === true
			&& state.projectLock?.projectId === project.id
			&& state.projectLock.readOnly === false,
		);
		if (state.projectLock?.readOnly || (state.readOnly && !featureRequirementReadOnly)) {
			throw new Error(copy.projectReadOnly);
		}
		if (!featureRequirementReadOnly) await flushProject();
		if (getProject() !== project) throw new Error(copy.projectNotFound);
		await store.prepareProjectHandoff?.(project);
		if (getProject() !== project) throw new Error(copy.projectNotFound);
		await releaseProjectLock();
		return Object.freeze({ projectId: project.id, revision: project.revision });
	}

	async function clearRecentProjects() {
		return projectSessionService.clearRecentProjects();
	}

	async function closeProjectTab(projectId: any = getProject()?.id, closeOptions: any = {}) {
		const project = getProject();
		const tab = sessionTab(projectId);
		if (!tab) throw new Error(copy.projectNotFound);
		const active = project?.id === projectId;
		if (tab.dirty && closeOptions.discard !== true) {
			if (active) {
				if (!state.readOnly) await saveNow();
			} else if (!tab.readOnly) {
				await store.saveProject(tab.history.present, {
					protectedLinkedOriginalSourceReferences: Object.freeze([
						...liveSessionLinkedOriginalSourceReferences(),
					]),
				});
				sessionController.markProjectSaved(projectId);
			}
		}
		const result = sessionController.closeProject(projectId, { force: true });
		if (!result.closed) return result;
		if (!active) {
			clipTimePitchCache.retainClipIds?.(liveSessionClipIds());
			evictUnreferencedSourceCaches(sourceBuffers, sourcePeaks, liveSessionSourceIds());
			publishDocumentSnapshot();
			await garbageCollectSources();
			return result;
		}

		projectSaveService.cancelScheduled();
		await releaseProjectLock();
		engine.stop();
		state.history = null;
		setProject(null);
		state.selectedTrackId = null;
		state.selectedClipId = null;
		state.selectedAnnotationId = null;
		state.missingSourceIds.clear();
		const nextTab = result.activeProjectId ? sessionTab(result.activeProjectId) : null;
		if (nextTab) await switchProject(nextTab.history.present, { skipFlush: true });
		else await newProject({ skipFlush: true });
		state.projects = Object.freeze(await store.listProjects());
		clipTimePitchCache.retainClipIds?.(liveSessionClipIds());
		evictUnreferencedSourceCaches(sourceBuffers, sourcePeaks, liveSessionSourceIds());
		publishDocumentSnapshot();
		await garbageCollectSources();
		return result;
	}

	async function renameProject(requestedTitle: any) {
		if (state.readOnly) return;
		if (requestedTitle == null) throw new TypeError(copy.projectTitleRequired);
		const title = String(requestedTitle).trim();
		if (title) commit({ type: 'project/rename', title });
	}

	async function duplicateProject(requestedTitle: any) {
		if (recoveryBlocked()) return null;
		const project = getProject();
		if (!project) return;
		await saveNow();
		if (getProject() !== project) return null;
		const title = String(requestedTitle || `${project.title} ${copy.projectCopySuffix}`).trim();
		const duplicated = await store.duplicateProject(project.id, { title });
		await persistSetting(recordingRoutingSettingKey(duplicated.id), state.recordingRouting, { policy: 'required' });
		await openProject(duplicated);
		return duplicated;
	}

	async function deleteProject() {
		const project = getProject();
		if (!project || state.readOnly || recoveryBlocked()) return;
		await stopRecording();
		if (getProject() !== project) return null;
		const id = project.id;
		await releaseProjectLock();
		await revokeVideoVisuals();
		engine.stop();
		await stopProjectBinPreview({ dispose: true });
		await disposeRenderEngines();
		sourceChunkProviders.clear();
		await sourceChunkProviders.drain?.();
		await store.deleteProject(id);
		await persistSetting(recordingRoutingSettingKey(id), null, { policy: 'required' });
		sessionController.closeProject(id, { force: true });
		state.history = null;
		setProject(null);
		state.selectedAnnotationId = null;
		state.missingSourceIds.clear();
		evictUnreferencedSourceCaches(sourceBuffers, sourcePeaks, liveSessionSourceIds());
		await garbageCollectSources();
		await newProject({ skipFlush: true });
		await listProjects();
	}

	async function garbageCollectSources() {
		if (recoveryBlocked()) return;
		if (!store.pruneUnreferencedSources) return;
		clearScheduledTimer(state.sourceGcTimer);
		state.sourceGcTimer = 0;
		const protectedSourceIds = liveSessionSourceIds();
		for (const sourceId of sourceChunkProviders.keys()) {
			if (!protectedSourceIds.has(sourceId)) sourceChunkProviders.delete(sourceId);
		}
		await sourceChunkProviders.drain?.();
		for (const sourceId of sourceBuffers.keys()) protectedSourceIds.add(sourceId);
		for (const sourceId of sourcePeaks.keys()) protectedSourceIds.add(sourceId);
		if (projectMaintenanceRuntime) {
			const currentProject = getProject();
			if (!currentProject) return;
			const maintenance = await projectMaintenanceRuntime.reconcileAndCollectStorageRoots({
				currentProject,
				pendingSaveSnapshots: projectSaveService.pendingSnapshots,
			});
			for (const storageRoot of maintenance.storageRoots) protectedSourceIds.add(storageRoot);
		}
		const result = await store.pruneUnreferencedSources({
			protectedProjects: [
				...sessionHistoryProjects(),
				...projectSaveService.pendingSnapshots,
			],
			protectedSourceIds,
		});
		for (const sourceId of result.deletedSourceIds || []) {
			sourceBuffers.delete(sourceId);
			sourceChunkProviders.delete(sourceId);
			sourcePeaks.delete(sourceId);
			state.missingSourceIds.delete(sourceId);
		}
		await sourceChunkProviders.drain?.();
		if (result.nextEligibleAt != null && !state.disposed) {
			const delay = Math.max(1_000, Math.min(2_147_000_000, result.nextEligibleAt - currentTimeMs() + 50));
			state.sourceGcTimer = scheduleTimer(() => {
				state.sourceGcTimer = 0;
				void garbageCollectSources().catch(handleError);
			}, delay);
		}
	}

	function sessionHistoryProjects() {
		return sessionController.getSnapshot().tabs
			.flatMap((tab: any) => editorHistoryProjects(tab.history));
	}

	async function clearLocalData() {
		if (recoveryBlocked()) return;
		await stopRecording();
		cancelPlaybackCachePreparation();
		await releaseProjectLock();
		engine.stop();
		await stopProjectBinPreview({ dispose: true });
		await disposeRenderEngines();
		sourceChunkProviders.clear();
		await sourceChunkProviders.drain?.();
		clipTimePitchCache.clear?.();
		sourceBuffers.clear();
		sourcePeaks.clear();
		clearWaveformPcmWindows();
		await revokeVideoVisuals();
		await store.clear();
		sessionController.clearClipboard();
		for (const tab of [...sessionController.getSnapshot().tabs]) {
			sessionController.closeProject(tab.projectId, { force: true });
		}
		state.history = null;
		setProject(null);
		state.selectedAnnotationId = null;
		await newProject({ skipFlush: true });
		state.projects = Object.freeze(store.preservesProjectsOnClear?.() ? await store.listProjects() : []);
		publishDocumentSnapshot();
	}

	return Object.freeze({
		clearLocalData,
		clearRecentProjects,
		closeProjectTab,
		deleteProject,
		duplicateProject,
		garbageCollectSources,
		listProjects,
		prepareProjectHandoff,
		renameProject,
		sessionHistoryProjects,
	});
}
