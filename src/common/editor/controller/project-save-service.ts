import {
	projectProtectedLinkedOriginalSourceReferences,
	type ProjectLinkedOriginalSourceReference,
} from '../storage/project-publication-options.ts';

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
	readonly hasUnsavedProjectChanges?: () => boolean;
	readonly isReadOnly: () => boolean;
	readonly cloneProject: (project: Project) => Project;
	readonly admitProjectPublication: (bytes: number) => Promise<unknown>;
	readonly collectProtectedLinkedOriginalSourceReferences?: (
	) => Iterable<ProjectLinkedOriginalSourceReference>;
	readonly saveProject: (snapshot: Project, options: {
		readonly admitProjectPublication: (bytes: number) => Promise<unknown>;
		readonly protectedLinkedOriginalSourceReferences?: readonly ProjectLinkedOriginalSourceReference[];
	}) => Promise<unknown>;
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

interface ProjectSaveAdmissionGate {
	count: number;
	readonly promise: Promise<void>;
	readonly open: () => void;
}

/**
 * Serializes project persistence independently from controller feature work.
 * Every queued snapshot is written, but only the newest generation for the
 * active project may publish a saved state. A terminal flush closes scheduling
 * before appending its final snapshot to the same queue. Temporary suspension
 * closes either all save admission or one exact project's admission while its
 * owner drains the stable queue.
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
	let suspended = false;
	let scheduledProjectId: string | null = null;
	const suspendedProjects = new Map<string, ProjectSaveAdmissionGate>();

	return Object.freeze({
		scheduleAutosave,
		flushProject,
		terminalFlush,
		suspend,
		resume: () => { suspended = false; },
		suspendProject,
		resumeProject,
		cancelScheduled,
		drain: () => state.saveQueue,
		get pendingSnapshots(): ReadonlySet<Project> {
			return state.pendingSaveSnapshots;
		},
	});

	function scheduleAutosave(): boolean {
		if (terminal || suspended || dependencies.isReadOnly()) return false;
		const project = dependencies.getProject();
		if (!project) { cancelScheduled(); return false; }
		if (suspendedProjects.has(project.id)) {
			if (scheduledProjectId === project.id) cancelScheduled();
			return false;
		}
		cancelScheduled();
		state.saveGeneration += 1;
		const generation = state.saveGeneration;
		const snapshot = dependencies.cloneProject(project);
		state.saveState = 'saving';
		dependencies.publish();
		scheduledProjectId = project.id;
		state.autosaveTimer = scheduleTimer(() => {
			state.autosaveTimer = 0;
			scheduledProjectId = null;
			void enqueueSaveSnapshot(snapshot, generation).catch(() => undefined);
		}, autosaveDelayMs);
		return true;
	}

	function cancelScheduled(): void {
		if (state.autosaveTimer) clearTimer(state.autosaveTimer);
		state.autosaveTimer = 0;
		scheduledProjectId = null;
	}

	function suspend(): void {
		suspended = true;
		cancelScheduled();
	}

	function suspendProject(projectId: string): void {
		if (typeof projectId !== 'string' || !projectId) {
			throw new TypeError('A project save suspension requires a project ID.');
		}
		const current = suspendedProjects.get(projectId);
		if (current) current.count += 1;
		else {
			let open: () => void = () => undefined;
			const promise = new Promise<void>((resolve) => { open = resolve; });
			suspendedProjects.set(projectId, { count: 1, promise, open });
		}
		if (scheduledProjectId === projectId) cancelScheduled();
	}

	function resumeProject(projectId: string): boolean {
		const gate = suspendedProjects.get(projectId);
		if (!gate) return false;
		if (gate.count > 1) gate.count -= 1;
		else {
			suspendedProjects.delete(projectId);
			gate.open();
		}
		return true;
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
		if (suspended || (terminal && !allowTerminal)) return undefined;
		const project = dependencies.getProject();
		if (!dependencies.hasHistory() || dependencies.isReadOnly()
			|| dependencies.hasUnsavedProjectChanges?.() === false) {
			if (!project || scheduledProjectId === project.id) cancelScheduled();
			return undefined;
		}
		if (project) {
			const gate = suspendedProjects.get(project.id);
			if (gate) {
				if (scheduledProjectId === project.id) cancelScheduled();
				return gate.promise.then(() => flushCurrentProject(allowTerminal));
			}
		}
		cancelScheduled();
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
			const protectedLinkedOriginalSourceReferences = dependencies.collectProtectedLinkedOriginalSourceReferences
				? projectProtectedLinkedOriginalSourceReferences({
					protectedLinkedOriginalSourceReferences: [
						...dependencies.collectProtectedLinkedOriginalSourceReferences(),
					],
				}) ?? undefined
				: undefined;
			await dependencies.saveProject(snapshot, {
				admitProjectPublication: dependencies.admitProjectPublication,
				...(protectedLinkedOriginalSourceReferences
					? { protectedLinkedOriginalSourceReferences }
					: {}),
			});
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
