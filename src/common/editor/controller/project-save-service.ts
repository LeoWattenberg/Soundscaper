import {
	projectProtectedLinkedOriginalSourceReferences,
	type ProjectLinkedOriginalSourceReference,
} from '../storage/project-publication-options.ts';

export interface ProjectSaveSnapshot {
	readonly id: string;
}

export interface ProjectFlushOptions {
	readonly forceCurrentSnapshot?: boolean;
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
	readonly prepareSnapshot?: (snapshot: Project) => PromiseLike<Project> | Project;
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
	let suspensionCount = 0;
	let scheduledProjectId: string | null = null;
	const suspendedProjects = new Map<string, ProjectSaveAdmissionGate>();
	const projectSaveEpochs = new Map<string, number>();

	return Object.freeze({
		scheduleAutosave,
		flushProject,
		terminalFlush,
		suspend,
		resume: () => { suspensionCount = Math.max(0, suspensionCount - 1); },
		suspendProject,
		resumeProject,
		retireProjectSaves,
		cancelScheduled,
		drain: () => state.saveQueue,
		get pendingSnapshots(): ReadonlySet<Project> {
			return state.pendingSaveSnapshots;
		},
	});

	function scheduleAutosave(): boolean {
		if (terminal || suspensionCount > 0 || dependencies.isReadOnly()) return false;
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
		const projectSaveEpoch = currentProjectSaveEpoch(project.id);
		state.saveState = 'saving';
		dependencies.publish();
		scheduledProjectId = project.id;
		state.autosaveTimer = scheduleTimer(() => {
			state.autosaveTimer = 0;
			scheduledProjectId = null;
			void enqueueSaveSnapshot(snapshot, generation, projectSaveEpoch).catch(() => undefined);
		}, autosaveDelayMs);
		return true;
	}

	function cancelScheduled(): void {
		if (state.autosaveTimer) clearTimer(state.autosaveTimer);
		state.autosaveTimer = 0;
		scheduledProjectId = null;
	}

	function suspend(): void {
		suspensionCount += 1;
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

	/** Retire captured snapshots while the caller holds project-scoped save suspension. */
	function retireProjectSaves(projectId: string): void {
		if (typeof projectId !== 'string' || !projectId) {
			throw new TypeError('Retiring project saves requires a project ID.');
		}
		if (!suspendedProjects.has(projectId)) {
			throw new Error('Project save admission must be suspended before retirement.');
		}
		projectSaveEpochs.set(projectId, currentProjectSaveEpoch(projectId) + 1);
		if (scheduledProjectId === projectId) cancelScheduled();
	}

	function flushProject(options: ProjectFlushOptions = {}): Promise<unknown> | undefined {
		return flushCurrentProject(false, options.forceCurrentSnapshot === true);
	}

	async function terminalFlush(): Promise<unknown> {
		terminal = true;
		const operation = flushCurrentProject(true, false);
		if (operation) return operation;
		return state.saveQueue;
	}

	function flushCurrentProject(
		allowTerminal: boolean,
		forceCurrentSnapshot: boolean,
	): Promise<unknown> | undefined {
		if (suspensionCount > 0 || (terminal && !allowTerminal)) return undefined;
		const project = dependencies.getProject();
		if (!dependencies.hasHistory() || dependencies.isReadOnly()
			|| (!forceCurrentSnapshot && dependencies.hasUnsavedProjectChanges?.() === false)) {
			if (!project || scheduledProjectId === project.id) cancelScheduled();
			return undefined;
		}
		if (project) {
			const gate = suspendedProjects.get(project.id);
			if (gate) {
				if (scheduledProjectId === project.id) cancelScheduled();
				return gate.promise.then(() => flushCurrentProject(allowTerminal, forceCurrentSnapshot));
			}
		}
		cancelScheduled();
		if (!project) return undefined;
		const generation = state.saveGeneration;
		return enqueueSaveSnapshot(
			dependencies.cloneProject(project),
			generation,
			currentProjectSaveEpoch(project.id),
		);
	}

	function enqueueSaveSnapshot(
		snapshot: Project,
		generation: number,
		projectSaveEpoch: number,
	): Promise<unknown> {
		const operation = state.saveQueue
			.catch(() => undefined)
			.then(() => saveSnapshot(snapshot, generation, projectSaveEpoch));
		state.saveQueue = operation;
		return operation;
	}

	async function saveSnapshot(
		snapshotValue: Project,
		generation: number,
		projectSaveEpoch: number,
	): Promise<void> {
		if (!ownsProjectSaveEpoch(snapshotValue.id, projectSaveEpoch)) return;
		let snapshot: Project;
		try {
			snapshot = dependencies.prepareSnapshot
				? await dependencies.prepareSnapshot(snapshotValue)
				: snapshotValue;
		} catch (error) {
			if (!ownsProjectSaveEpoch(snapshotValue.id, projectSaveEpoch)) return;
			throw error;
		}
		if (!ownsProjectSaveEpoch(snapshotValue.id, projectSaveEpoch)) return;
		if (!snapshot || snapshot.id !== snapshotValue.id) {
			throw new Error('Project save preparation changed the project identity.');
		}
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
				admitProjectPublication: async (bytes) => {
					if (!ownsProjectSaveEpoch(snapshot.id, projectSaveEpoch)) {
						throw new DOMException('The project save was retired.', 'AbortError');
					}
					await dependencies.admitProjectPublication(bytes);
					if (!ownsProjectSaveEpoch(snapshot.id, projectSaveEpoch)) {
						throw new DOMException('The project save was retired.', 'AbortError');
					}
				},
				...(protectedLinkedOriginalSourceReferences
					? { protectedLinkedOriginalSourceReferences }
					: {}),
			});
			state.pendingSaveSnapshots.delete(snapshot);
			if (!ownsProjectSaveEpoch(snapshot.id, projectSaveEpoch)) return;
			if (dependencies.isCurrentProject(snapshot.id)) {
				await dependencies.persistActiveProjectId(snapshot.id);
			}
			if (!ownsProjectSaveEpoch(snapshot.id, projectSaveEpoch)) return;
			if (dependencies.isCurrentProject(snapshot.id) && generation === state.saveGeneration) {
				if (dependencies.hasSessionTab(snapshot.id)) dependencies.markProjectSaved(snapshot.id);
				state.saveState = 'saved';
				dependencies.publish();
			}
			await dependencies.garbageCollect();
			await dependencies.refreshStorageUsage();
		} catch (error) {
			if (!ownsProjectSaveEpoch(snapshot.id, projectSaveEpoch)) return;
			state.saveState = 'dirty';
			dependencies.publish();
			dependencies.handleError(error);
			throw error;
		} finally {
			state.pendingSaveSnapshots.delete(snapshot);
		}
	}

	function currentProjectSaveEpoch(projectId: string): number {
		return projectSaveEpochs.get(projectId) ?? 0;
	}

	function ownsProjectSaveEpoch(projectId: string, epoch: number): boolean {
		return currentProjectSaveEpoch(projectId) === epoch;
	}
}
