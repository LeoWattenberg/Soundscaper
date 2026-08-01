import { estimateProjectRevisionPublication } from '../project-publication-admission.ts';

export interface ProjectSaveSnapshot {
	readonly id: string;
}

export interface ProjectSaveState<Project extends ProjectSaveSnapshot> {
	autosaveTimer: number;
	saveGeneration: number;
	pendingSaveSnapshots: Set<Project>;
	saveQueue: Promise<unknown>;
	saveState: string;
}

export interface ProjectSaveServiceDependencies<Project extends ProjectSaveSnapshot> {
	readonly state: ProjectSaveState<Project>;
	readonly getProject: () => Project | null;
	readonly hasHistory: () => boolean;
	readonly isReadOnly: () => boolean;
	readonly cloneProject: (project: Project) => Project;
	readonly admitProjectPublication: (bytes: number) => Promise<unknown>;
	readonly saveProject: (snapshot: Project) => Promise<unknown>;
	readonly persistActiveProjectId: (projectId: string) => Promise<unknown>;
	readonly isCurrentProject: (projectId: string) => boolean;
	readonly hasSessionTab: (projectId: string) => boolean;
	readonly markProjectSaved: (projectId: string) => void;
	readonly publish: () => void;
	readonly garbageCollect: () => Promise<unknown>;
	readonly refreshStorageUsage: () => Promise<unknown>;
	readonly handleError: (error: unknown) => void;
	readonly scheduleTimer?: (callback: () => void, delayMs: number) => number;
	readonly clearTimer?: (handle: number) => void;
	readonly autosaveDelayMs?: number;
}

/**
 * Serializes project persistence independently from controller feature work.
 * Every queued snapshot is written, but only the newest generation for the
 * active project may publish a saved state. A terminal flush closes scheduling
 * before appending its final snapshot to the same queue.
 */
export function createProjectSaveService<Project extends ProjectSaveSnapshot>(
	dependencies: ProjectSaveServiceDependencies<Project>,
) {
	const {
		state,
	} = dependencies;
	const scheduleTimer = dependencies.scheduleTimer || ((callback, delayMs) => Number(globalThis.setTimeout(callback, delayMs)));
	const clearTimer = dependencies.clearTimer || ((handle) => globalThis.clearTimeout(handle));
	const autosaveDelayMs = dependencies.autosaveDelayMs ?? 500;
	let terminal = false;

	return Object.freeze({
		scheduleAutosave,
		flushProject,
		terminalFlush,
		cancelScheduled,
		drain: () => state.saveQueue,
		get pendingSnapshots(): ReadonlySet<Project> {
			return state.pendingSaveSnapshots;
		},
	});

	function scheduleAutosave(): boolean {
		if (terminal || dependencies.isReadOnly()) return false;
		cancelScheduled();
		state.saveGeneration += 1;
		const generation = state.saveGeneration;
		const project = dependencies.getProject();
		if (!project) return false;
		const snapshot = dependencies.cloneProject(project);
		state.saveState = 'saving';
		dependencies.publish();
		state.autosaveTimer = scheduleTimer(() => {
			state.autosaveTimer = 0;
			void enqueueSaveSnapshot(snapshot, generation).catch(() => undefined);
		}, autosaveDelayMs);
		return true;
	}

	function cancelScheduled(): void {
		if (state.autosaveTimer) clearTimer(state.autosaveTimer);
		state.autosaveTimer = 0;
	}

	function flushProject(): Promise<unknown> | undefined {
		return flushCurrentProject(false);
	}

	async function terminalFlush(): Promise<unknown> {
		terminal = true;
		const operation = flushCurrentProject(true);
		if (operation) return operation;
		return state.saveQueue;
	}

	function flushCurrentProject(allowTerminal: boolean): Promise<unknown> | undefined {
		if (terminal && !allowTerminal) return undefined;
		if (!dependencies.hasHistory() || dependencies.isReadOnly()) {
			cancelScheduled();
			return undefined;
		}
		cancelScheduled();
		const project = dependencies.getProject();
		if (!project) return undefined;
		const generation = state.saveGeneration;
		return enqueueSaveSnapshot(dependencies.cloneProject(project), generation);
	}

	function enqueueSaveSnapshot(snapshot: Project, generation: number): Promise<unknown> {
		const operation = state.saveQueue
			.catch(() => undefined)
			.then(() => saveSnapshot(snapshot, generation));
		state.saveQueue = operation;
		return operation;
	}

	async function saveSnapshot(snapshot: Project, generation: number): Promise<void> {
		state.pendingSaveSnapshots.add(snapshot);
		try {
			const estimate = estimateProjectRevisionPublication(snapshot);
			await dependencies.admitProjectPublication(estimate.currentAndRevision.bytes);
			await dependencies.saveProject(snapshot);
			state.pendingSaveSnapshots.delete(snapshot);
			if (dependencies.isCurrentProject(snapshot.id)) {
				await dependencies.persistActiveProjectId(snapshot.id);
			}
			if (dependencies.isCurrentProject(snapshot.id) && generation === state.saveGeneration) {
				if (dependencies.hasSessionTab(snapshot.id)) dependencies.markProjectSaved(snapshot.id);
				state.saveState = 'saved';
				dependencies.publish();
			}
			await dependencies.garbageCollect();
			await dependencies.refreshStorageUsage();
		} catch (error) {
			state.saveState = 'dirty';
			dependencies.publish();
			dependencies.handleError(error);
			throw error;
		} finally {
			state.pendingSaveSnapshots.delete(snapshot);
		}
	}
}
