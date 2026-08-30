/* SPDX-License-Identifier: AGPL-3.0-only */

/* eslint-disable @typescript-eslint/no-explicit-any -- Explicit legacy ports keep the project-administration composition seam typo-safe. */

import type {
	FramescaperCaptureAdminInterlockLease,
	FramescaperCaptureAdminOperationRequest,
} from './framescaper-capture-admin-interlock.ts';

type LegacyPort = (...args: any[]) => any;

interface SourceChunkProviderMap extends Map<string, any> {
	drain?(): PromiseLike<void> | void;
}

export interface ProjectAdminServiceRuntime {
	readonly beginCaptureInterlockedAdminOperation?: (
		request: Readonly<FramescaperCaptureAdminOperationRequest>,
	) => Readonly<FramescaperCaptureAdminInterlockLease>;
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
	readonly projectGeneration: Readonly<{
		activate(projectId: string): unknown;
		invalidate(): void;
	}>;
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

export interface ProjectHandoffExpectation {
	readonly projectId: string;
	readonly revision: number;
}

export function createProjectAdminService(runtime: ProjectAdminServiceRuntime) {
	const {
		beginCaptureInterlockedAdminOperation,
		cancelPlaybackCachePreparation, clearScheduledTimer, clearWaveformPcmWindows,
		clipTimePitchCache, commit, copy, currentTimeMs, disposeRenderEngines, editorHistoryProjects, engine,
		evictUnreferencedSourceCaches, flushProject, getProject, handleError,
		liveSessionClipIds, liveSessionLinkedOriginalSourceReferences,
		liveSessionSourceIds, newProject, openProject, persistSetting,
		projectSaveService, projectGeneration, projectMaintenanceRuntime, projectSessionService, publishDocumentSnapshot,
		recordingRoutingSettingKey, releaseProjectLock, revokeVideoVisuals, saveNow,
		scheduleTimer, sessionController, sessionTab, setProject, sourceBuffers,
		sourceChunkProviders, sourcePeaks, state, stopProjectBinPreview, stopRecording, store, switchProject,
	} = runtime;
	const recoveryBlocked = () => Boolean(
		state.takeCycleRecovery || state.takeCycleRecoveryInspecting,
	);
	let clearLocalDataOperation: Promise<void> | null = null;
	let sourceGarbageCollectionGeneration = 0;

	async function listProjects() {
		await saveNow();
		state.projects = Object.freeze(await store.listProjects());
		publishDocumentSnapshot();
		return state.projects;
	}

	function projectHandoffPreflight(expected?: Readonly<ProjectHandoffExpectation>) {
		if (recoveryBlocked()) throw new Error(copy.projectReadOnly);
		const project = getProject();
		if (!project) throw new Error(copy.projectNotFound);
		assertExpectedHandoffProject(project, expected);
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
		return Object.freeze({ project, featureRequirementReadOnly });
	}

	function assertProjectHandoffAllowed(): void {
		void projectHandoffPreflight();
	}

	async function prepareProjectHandoff(expected?: Readonly<ProjectHandoffExpectation>) {
		const { project, featureRequirementReadOnly } = projectHandoffPreflight(expected);
		const interlock = beginCaptureInterlockedAdminOperation?.({ kind: 'handoff', projectId: project.id });
		try {
			if (!featureRequirementReadOnly) await flushProject();
			if (getProject() !== project) throw new Error(copy.projectNotFound);
			assertExpectedHandoffProject(project, expected);
			await store.prepareProjectHandoff?.(project);
			if (getProject() !== project) throw new Error(copy.projectNotFound);
			assertExpectedHandoffProject(project, expected);
			interlock?.assertCurrent();
			await releaseProjectLock();
			return Object.freeze({ projectId: project.id, revision: project.revision });
		} finally {
			interlock?.release();
		}
	}

	function assertExpectedHandoffProject(
		project: Readonly<{ id?: unknown; revision?: unknown }>,
		expected?: Readonly<ProjectHandoffExpectation>,
	): void {
		if (expected === undefined) return;
		if (project.id !== expected.projectId || project.revision !== expected.revision) {
			throw new Error('The project changed while preparing its editable-copy handoff. Try again.');
		}
	}

	async function clearRecentProjects() {
		return projectSessionService.clearRecentProjects();
	}

	async function closeProjectTab(projectId: any = getProject()?.id, closeOptions: any = {}) {
		const project = getProject();
		const tab = sessionTab(projectId);
		if (!tab) throw new Error(copy.projectNotFound);
		const interlock = beginCaptureInterlockedAdminOperation?.({ kind: 'close', projectId });
		try { return await closeProjectTabReserved(project, tab, projectId, closeOptions, interlock); }
		finally { interlock?.release(); }
	}

	async function closeProjectTabReserved(
		project: any, tab: any, projectId: any, closeOptions: any,
		interlock: Readonly<FramescaperCaptureAdminInterlockLease> | undefined,
	) {
		const active = project?.id === projectId;
		const discard = closeOptions.discard === true;
		let projectSaveSuspended = false;
		let inactiveCloseReservation: Readonly<{ release(): boolean }> | null = null;
		if (discard) {
			projectSaveService.suspendProject(projectId);
			projectSaveSuspended = true;
		}
		try {
			if (discard) {
				projectSaveService.retireProjectSaves(projectId);
				await projectSaveService.drain();
			}
			if (active) {
				const tabs = sessionController.getSnapshot().tabs;
				const index = tabs.findIndex((candidate: any) => candidate.projectId === projectId);
				if (index < 0) throw new Error(copy.projectNotFound);
				const nextTab = tabs[index + 1] ?? tabs[index - 1] ?? null;
				if (nextTab) {
					await switchProject(nextTab.history.present, { skipFlush: discard });
				} else await newProject({ skipFlush: discard });
			} else if (tab.dirty && !discard && !tab.readOnly) {
				const historyCapture = sessionController.captureProjectHistory(projectId);
				inactiveCloseReservation = sessionController.beginProjectActivation(projectId, {
					expectedHistoryToken: historyCapture.token,
				});
				await store.saveProject(historyCapture.history.present, {
					protectedLinkedOriginalSourceReferences: Object.freeze([
						...liveSessionLinkedOriginalSourceReferences(),
					]),
				});
				sessionController.markProjectSaved(projectId);
			}
			interlock?.assertCurrent();
			inactiveCloseReservation?.release();
			inactiveCloseReservation = null;
			const result = sessionController.closeProject(projectId, { force: true });
			if (!result.closed) return result;
			if (active) state.projects = Object.freeze(await store.listProjects());
			clipTimePitchCache.retainClipIds?.(liveSessionClipIds());
			evictUnreferencedSourceCaches(sourceBuffers, sourcePeaks, liveSessionSourceIds());
			publishDocumentSnapshot();
			await garbageCollectSources();
			return result;
		} finally {
			inactiveCloseReservation?.release();
			if (projectSaveSuspended) projectSaveService.resumeProject(projectId);
		}
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
		const recordingRouting = structuredClone(state.recordingRouting);
		await saveNow();
		if (getProject() !== project) return null;
		const title = String(requestedTitle || `${project.title} ${copy.projectCopySuffix}`).trim();
		const duplicated = await store.duplicateProject(project.id, { title });
		await persistSetting(recordingRoutingSettingKey(duplicated.id), recordingRouting, { policy: 'required' });
		if (getProject() !== project) {
			state.projects = Object.freeze(await store.listProjects());
			publishDocumentSnapshot();
			return duplicated;
		}
		await openProject(duplicated);
		return duplicated;
	}

	async function deleteProject() {
		const project = getProject();
		if (!project || state.readOnly || recoveryBlocked()) return;
		const interlock = beginCaptureInterlockedAdminOperation?.({ kind: 'delete', projectId: project.id });
		try { return await deleteProjectReserved(project, interlock); }
		finally { interlock?.release(); }
	}

	async function deleteProjectReserved(
		project: any,
		interlock: Readonly<FramescaperCaptureAdminInterlockLease> | undefined,
	) {
		await stopRecording();
		if (getProject() !== project) return null;
		interlock?.assertCurrent();
		const id = project.id;
		const historyCapture = sessionController.captureProjectHistory(id);
		const activation = sessionController.beginProjectActivation(id, {
			expectedHistoryToken: historyCapture.token,
		});
		const failures: unknown[] = [];
		const attempt = async (operation: () => PromiseLike<unknown> | unknown): Promise<void> => {
			try { await operation(); } catch (error) { failures.push(error); }
		};
		let deleteAttempted = false;
		let deleteResolved = false;
		let saveSuspended = false;
		try {
			// These synchronous operations close mutation, project-token, and save
			// admission before the first drain await. The exact-history reservation
			// prevents a competing tab activation from replacing that ownership.
			projectSaveService.suspend();
			saveSuspended = true;
			projectGeneration.invalidate();
			state.history = null;
			setProject(null);
			try {
				await projectSaveService.drain();
				await releaseProjectLock();
				await revokeVideoVisuals();
				engine.stop();
				await stopProjectBinPreview({ dispose: true });
				await disposeRenderEngines();
				sourceChunkProviders.clear();
				await sourceChunkProviders.drain?.();
				interlock?.assertCurrent();
				deleteAttempted = true;
				await store.deleteProject(id);
				deleteResolved = true;
			} catch (error) {
				failures.push(error);
			}
			if (deleteResolved) {
				await attempt(() => persistSetting(recordingRoutingSettingKey(id), null, { policy: 'required' }));
			}

			// Queue the replacement synchronously after releasing and closing the
			// old tab, so later activation requests serialize behind this one.
			activation.release();
			try {
				const result = sessionController.closeProject(id, { force: true });
				if (result?.closed === false) throw new Error('The deleted project session could not be closed.');
			} catch (error) {
				failures.push(error);
			}
			state.selectedTrackId = null;
			state.selectedClipId = null;
			state.selectedAnnotationId = null;
			state.missingSourceIds.clear();
			state.projects = Object.freeze([]);
			let nextProject: unknown;
			let nextProjectStarted = false;
			try {
				nextProject = newProject({ skipFlush: true });
				nextProjectStarted = true;
			} catch (error) {
				failures.push(error);
			}
			if (nextProjectStarted) await attempt(() => nextProject);
			if (deleteAttempted) {
				await attempt(() => evictUnreferencedSourceCaches(sourceBuffers, sourcePeaks, liveSessionSourceIds()));
				await attempt(() => garbageCollectSources());
			}
			let listed = false;
			await attempt(async () => {
				await listProjects();
				listed = true;
			});
			if (!listed) await attempt(() => publishDocumentSnapshot());
		} finally {
			activation.release();
			if (saveSuspended) projectSaveService.resume();
		}
		throwProjectDeletionFailures(failures);
	}

	async function garbageCollectSources() {
		if (recoveryBlocked()) return;
		if (!store.pruneUnreferencedSources) return;
		const generation = ++sourceGarbageCollectionGeneration;
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
		if (result.nextEligibleAt != null && !state.disposed
			&& generation === sourceGarbageCollectionGeneration) {
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

	function clearLocalData(): Promise<void> {
		if (clearLocalDataOperation) return clearLocalDataOperation;
		if (recoveryBlocked()) return Promise.resolve();
		const interlock = beginCaptureInterlockedAdminOperation?.({ kind: 'clear', projectId: null });
		const operation = clearLocalDataReserved(interlock);
		const trackedOperation = operation.finally(() => {
			interlock?.release();
			if (clearLocalDataOperation === trackedOperation) clearLocalDataOperation = null;
		});
		clearLocalDataOperation = trackedOperation;
		return trackedOperation;
	}

	async function clearLocalDataReserved(
		interlock: Readonly<FramescaperCaptureAdminInterlockLease> | undefined,
	) {
		const originProject = getProject();
		const originHistory = state.history;
		let replacementEstablished = false;
		let originRestorable = true;
		projectSaveService.suspend();
		projectGeneration.invalidate();
		state.history = null;
		setProject(null);
		try {
			await stopRecording();
			interlock?.assertCurrent();
			await projectSaveService.drain();
			cancelPlaybackCachePreparation();
			originRestorable = false;
			await releaseProjectLock();
			engine.stop();
			await stopProjectBinPreview({ dispose: true });
			await disposeRenderEngines();
			sourceChunkProviders.clear();
			await sourceChunkProviders.drain?.();
			await Promise.resolve(clipTimePitchCache.clear?.());
			sourceBuffers.clear();
			sourcePeaks.clear();
			clearWaveformPcmWindows();
			await revokeVideoVisuals();
			interlock?.assertCurrent();
			await store.clear();
			sessionController.clearClipboard();
			for (const tab of [...sessionController.getSnapshot().tabs]) {
				sessionController.closeProject(tab.projectId, { force: true });
			}
			state.selectedAnnotationId = null;
			await newProject({ skipFlush: true });
			replacementEstablished = true;
			state.projects = Object.freeze(store.preservesProjectsOnClear?.() ? await store.listProjects() : []);
			publishDocumentSnapshot();
		} finally {
			if (!replacementEstablished && originRestorable && originProject && originHistory) {
				state.history = originHistory;
				setProject(originProject);
				projectGeneration.activate(originProject.id);
				replacementEstablished = true;
			}
			projectSaveService.resume();
		}
	}

	return Object.freeze({
		clearLocalData,
		clearRecentProjects,
		closeProjectTab,
		deleteProject,
		duplicateProject,
		garbageCollectSources,
		listProjects,
		assertProjectHandoffAllowed,
		prepareProjectHandoff,
		renameProject,
		sessionHistoryProjects,
	});
}

function throwProjectDeletionFailures(failures: readonly unknown[]): void {
	if (failures.length === 0) return;
	if (failures.length === 1) throw failures[0];
	throw new AggregateError(
		failures,
		'Project deletion failed and one or more teardown operations could not be completed.',
		{ cause: failures[0] },
	);
}
