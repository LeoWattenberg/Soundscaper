import {
	projectProtectedLinkedOriginalSourceReferences,
	type ProjectLinkedOriginalSourceReference,
} from '../../storage/project-publication-options.ts';
import { ProjectCommittedMaintenanceError } from '../../storage/project-committed-maintenance-error.ts';
import { sameProjectSnapshot } from '../../storage/project-snapshot-equality.ts';

export interface ProjectSaveSnapshot {
	readonly id: string;
}

export interface ProjectFlushOptions {
	readonly forceCurrentSnapshot?: boolean;
	/** Prepare and persist the current snapshot even when document history is clean. */
	readonly prepareCurrentSnapshot?: boolean;
	readonly preparationPurpose?: ProjectSnapshotPreparationPurpose;
}

export type ProjectSnapshotPreparationPurpose = 'project-save' | 'scape-save';

export type ProjectSaveStatus = 'saving' | 'saved' | 'dirty';

export class ProjectSaveConflictError extends Error {
	constructor() {
		super('Project save lost its write authority or the stored document changed.');
		this.name = 'ProjectSaveConflictError';
	}
}

export interface ProjectSaveState<Project extends ProjectSaveSnapshot> {
	autosaveTimer: number;
	saveGeneration: number;
	pendingSaveSnapshots: Set<Project>;
	saveQueue: Promise<unknown>;
}

interface ProjectBeforeUnloadTarget {
	addEventListener(
		type: 'beforeunload',
		listener: (event: BeforeUnloadEvent) => void,
		options?: AddEventListenerOptions,
	): void;
}

export interface ProjectSaveServiceDependencies<Project extends ProjectSaveSnapshot> {
	/** Legacy injection for deterministic fixtures; production saves own their state. */
	readonly state?: ProjectSaveState<Project>;
	readonly getProject: () => Project | null;
	readonly hasHistory: () => boolean;
	readonly hasUnsavedProjectChanges?: () => boolean;
	readonly isReadOnly: () => boolean;
	/** The durable token claimed for the current project lock. */
	readonly getWriteFence?: (projectId: string) => string | null;
	readonly cloneProject: (project: Project) => Project;
	readonly prepareSnapshot?: (
		snapshot: Project,
		purpose: ProjectSnapshotPreparationPurpose,
	) => PromiseLike<Project> | Project;
	readonly admitProjectPublication: (bytes: number) => Promise<unknown>;
	readonly collectProtectedLinkedOriginalSourceReferences?: (
	) => Iterable<ProjectLinkedOriginalSourceReference>;
	readonly saveProject: (snapshot: Project, options: {
		readonly admitProjectPublication: (bytes: number) => Promise<unknown>;
		readonly protectedLinkedOriginalSourceReferences?: readonly ProjectLinkedOriginalSourceReference[];
	}) => Promise<unknown>;
	readonly saveProjectIfCurrentWithWriteFence?: (
		expected: Project,
		snapshot: Project,
		writeFence: string,
		options: {
			readonly admitProjectPublication: (bytes: number) => Promise<unknown>;
			readonly protectedLinkedOriginalSourceReferences?: readonly ProjectLinkedOriginalSourceReference[];
		},
	) => Promise<Project | null>;
	readonly onPublicationConflict?: (projectId: string) => void;
	readonly persistActiveProjectId: (projectId: string) => Promise<unknown>;
	readonly isCurrentProject: (projectId: string) => boolean;
	readonly hasSessionTab: (projectId: string) => boolean;
	readonly markProjectSaved: (projectId: string) => void;
	/** Report the active document's save status; its presentation belongs to the controller. */
	readonly publish: (saveState: ProjectSaveStatus) => void;
	readonly garbageCollect: () => Promise<unknown>;
	readonly refreshStorageUsage: () => Promise<unknown>;
	readonly handleError: (error: unknown) => void;
	readonly scheduleTimer?: (callback: () => void, delayMs: number) => number;
	readonly clearTimer?: (handle: number) => void;
	readonly autosaveDelayMs?: number;
	readonly beforeUnloadTarget?: ProjectBeforeUnloadTarget;
	readonly beforeUnloadSignal?: AbortSignal;
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
	const state = dependencies.state ?? createProjectSaveState<Project>();
	const scheduleTimer = dependencies.scheduleTimer || ((callback, delayMs) => Number(globalThis.setTimeout(callback, delayMs)));
	const clearTimer = dependencies.clearTimer || ((handle) => globalThis.clearTimeout(handle));
	const autosaveDelayMs = dependencies.autosaveDelayMs ?? 500;
	let terminal = false;
	let suspensionCount = 0;
	let scheduledProjectId: string | null = null;
	const suspendedProjects = new Map<string, ProjectSaveAdmissionGate>();
	const projectSaveEpochs = new Map<string, number>();
	const persistedSnapshots = new Map<string, Project>();
	const queuedSaveCounts = new Map<string, number>();
	dependencies.beforeUnloadTarget?.addEventListener('beforeunload', warnBeforeUnload, {
		signal: dependencies.beforeUnloadSignal,
	});

	return Object.freeze({
		scheduleAutosave,
		flushProject,
		terminalFlush,
		suspend,
		resume: () => { suspensionCount = Math.max(0, suspensionCount - 1); },
		suspendProject,
		resumeProject,
		retireProjectSaves,
		recordPersistedSnapshot,
		recordPersistedSnapshotFromStore,
		getPersistedSnapshot,
		forgetPersistedSnapshot: (projectId: string) => { persistedSnapshots.delete(projectId); },
		isPersistedSnapshotCurrent,
		cancelScheduled,
		drain: () => state.saveQueue,
		get pendingSnapshots(): ReadonlySet<Project> {
			return state.pendingSaveSnapshots;
		},
	});

	function warnBeforeUnload(event: BeforeUnloadEvent): void {
		const project = dependencies.getProject();
		if (!project || !dependencies.hasHistory()) return;
		const currentSavePending = scheduledProjectId === project.id
			|| queuedSaveCounts.has(project.id)
			|| [...state.pendingSaveSnapshots].some((snapshot) => snapshot.id === project.id);
		if (!currentSavePending && dependencies.hasUnsavedProjectChanges?.() !== true) return;
		event.preventDefault();
		event.returnValue = '';
	}

	/** Called only for a snapshot known to have been published or loaded from storage. */
	function recordPersistedSnapshot(project: Project): void {
		persistedSnapshots.set(project.id, structuredClone(project));
	}

	async function recordPersistedSnapshotFromStore(
		projectId: string,
		loadProject: (projectId: string) => Promise<unknown>,
	): Promise<void> {
		const project = await loadProject(projectId);
		if (!project || typeof project !== 'object' || (project as ProjectSaveSnapshot).id !== projectId) {
			if (project === null && dependencies.isReadOnly()) return;
			throw new Error('The activated project has no current stored snapshot.');
		}
		recordPersistedSnapshot(project as Project);
	}

	function getPersistedSnapshot(projectId: string): Project | null {
		const snapshot = persistedSnapshots.get(projectId);
		return snapshot ? structuredClone(snapshot) : null;
	}

	async function isPersistedSnapshotCurrent(
		projectId: string,
		loadProject: (projectId: string) => Promise<unknown>,
	): Promise<boolean> {
		const expected = persistedSnapshots.get(projectId);
		return Boolean(expected && sameProjectSnapshot(await loadProject(projectId), expected));
	}

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
		// Documents are replaced by commands. Retain this immutable generation;
		// cloning on every edit would defeat the debounce for large projects.
		const projectSaveEpoch = currentProjectSaveEpoch(project.id);
		const writeFence = dependencies.getWriteFence?.(project.id) ?? null;
		dependencies.publish('saving');
		scheduledProjectId = project.id;
		state.autosaveTimer = scheduleTimer(() => {
			state.autosaveTimer = 0;
			scheduledProjectId = null;
			void enqueueSaveSnapshot(project, generation, projectSaveEpoch, writeFence, 'project-save', true).catch(() => undefined);
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
		const prepareCurrentSnapshot = options.prepareCurrentSnapshot === true
			&& dependencies.prepareSnapshot !== undefined;
		return flushCurrentProject(
			false,
			options.forceCurrentSnapshot === true || prepareCurrentSnapshot,
			options.preparationPurpose ?? 'project-save',
		);
	}

	async function terminalFlush(): Promise<unknown> {
		terminal = true;
		const operation = flushCurrentProject(
			true,
			dependencies.prepareSnapshot !== undefined,
			'project-save',
		);
		if (operation) return operation;
		return state.saveQueue;
	}

	function flushCurrentProject(
		allowTerminal: boolean,
		forceCurrentSnapshot: boolean,
		preparationPurpose: ProjectSnapshotPreparationPurpose,
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
				return gate.promise.then(() => flushCurrentProject(
					allowTerminal, forceCurrentSnapshot, preparationPurpose,
				));
			}
		}
		cancelScheduled();
		if (!project) return undefined;
		const generation = state.saveGeneration;
		return enqueueSaveSnapshot(
			dependencies.cloneProject(project),
			generation,
			currentProjectSaveEpoch(project.id),
			dependencies.getWriteFence?.(project.id) ?? null,
			preparationPurpose,
		);
	}

	function enqueueSaveSnapshot(
		snapshot: Project,
		generation: number,
		projectSaveEpoch: number,
		writeFence: string | null,
		preparationPurpose: ProjectSnapshotPreparationPurpose,
		materialize = false,
	): Promise<unknown> {
		queuedSaveCounts.set(snapshot.id, (queuedSaveCounts.get(snapshot.id) ?? 0) + 1);
		const operation = state.saveQueue
			.catch(() => undefined)
			.then(() => saveSnapshot(snapshot, generation, projectSaveEpoch, writeFence, preparationPurpose, materialize))
			.finally(() => {
				const remaining = (queuedSaveCounts.get(snapshot.id) ?? 1) - 1;
				if (remaining) queuedSaveCounts.set(snapshot.id, remaining);
				else queuedSaveCounts.delete(snapshot.id);
			});
		state.saveQueue = operation;
		return operation;
	}

	async function saveSnapshot(
		snapshotValue: Project,
		generation: number,
		projectSaveEpoch: number,
		writeFence: string | null,
		preparationPurpose: ProjectSnapshotPreparationPurpose,
		materialize: boolean,
	): Promise<void> {
		if (!ownsProjectSaveEpoch(snapshotValue.id, projectSaveEpoch) || !ownsWriteFence(snapshotValue.id, writeFence)) return;
		let snapshot = snapshotValue;
		try {
			if (materialize) snapshot = dependencies.cloneProject(snapshotValue);
			snapshot = dependencies.prepareSnapshot
				? await dependencies.prepareSnapshot(snapshot, preparationPurpose)
				: snapshot;
			if (!ownsProjectSaveEpoch(snapshotValue.id, projectSaveEpoch) || !ownsWriteFence(snapshotValue.id, writeFence)) return;
			if (!snapshot || snapshot.id !== snapshotValue.id) {
				throw new Error('Project save preparation changed the project identity.');
			}
			state.pendingSaveSnapshots.add(snapshot);
			const protectedLinkedOriginalSourceReferences = dependencies.collectProtectedLinkedOriginalSourceReferences
				? projectProtectedLinkedOriginalSourceReferences({
					protectedLinkedOriginalSourceReferences: [
						...dependencies.collectProtectedLinkedOriginalSourceReferences(),
					],
				}) ?? undefined
				: undefined;
			const saveOptions = {
				admitProjectPublication: async (bytes: number) => {
					if (!ownsProjectSaveEpoch(snapshot.id, projectSaveEpoch) || !ownsWriteFence(snapshot.id, writeFence)) {
						throw new DOMException('The project save was retired.', 'AbortError');
					}
					await dependencies.admitProjectPublication(bytes);
					if (!ownsProjectSaveEpoch(snapshot.id, projectSaveEpoch) || !ownsWriteFence(snapshot.id, writeFence)) {
						throw new DOMException('The project save was retired.', 'AbortError');
					}
				},
				...(protectedLinkedOriginalSourceReferences
					? { protectedLinkedOriginalSourceReferences }
					: {}),
			};
			if (dependencies.saveProjectIfCurrentWithWriteFence) {
				const expected = persistedSnapshots.get(snapshot.id);
				if (!expected || !writeFence) throw new Error('Project save requires a persisted snapshot and write fence.');
				let maintenanceFailure: ProjectCommittedMaintenanceError | null = null;
				const saved = await dependencies.saveProjectIfCurrentWithWriteFence(expected, snapshot, writeFence, saveOptions)
					.catch((error: unknown): Project | null => {
						if (!(error instanceof ProjectCommittedMaintenanceError)
							|| error.committedProject.id !== snapshot.id) throw error;
						maintenanceFailure = error;
						return error.committedProject as unknown as Project;
					});
				if (saved === null) {
					dependencies.onPublicationConflict?.(snapshot.id);
					throw new ProjectSaveConflictError();
				}
				recordPersistedSnapshot(saved);
				if (maintenanceFailure) {
					try { dependencies.handleError(maintenanceFailure); }
					catch { /* Reporting cannot undo a committed project. */ }
				}
			} else await dependencies.saveProject(snapshot, saveOptions);
			state.pendingSaveSnapshots.delete(snapshot);
			if (!ownsProjectSaveEpoch(snapshot.id, projectSaveEpoch) || !ownsWriteFence(snapshot.id, writeFence)) return;
			if (dependencies.isCurrentProject(snapshot.id)) {
				await dependencies.persistActiveProjectId(snapshot.id);
			}
			if (!ownsProjectSaveEpoch(snapshot.id, projectSaveEpoch) || !ownsWriteFence(snapshot.id, writeFence)) return;
			if (dependencies.isCurrentProject(snapshot.id) && generation === state.saveGeneration) {
				if (dependencies.hasSessionTab(snapshot.id)) dependencies.markProjectSaved(snapshot.id);
				dependencies.publish('saved');
			}
			try {
				await dependencies.garbageCollect();
			} catch (maintenanceError) {
				dependencies.handleError(maintenanceError);
			}
			try {
				await dependencies.refreshStorageUsage();
			} catch (maintenanceError) {
				dependencies.handleError(maintenanceError);
			}
		} catch (error) {
			if (!ownsProjectSaveEpoch(snapshotValue.id, projectSaveEpoch)) return;
			if (!ownsWriteFence(snapshotValue.id, writeFence) && !(error instanceof ProjectSaveConflictError)) return;
			if (dependencies.isCurrentProject(snapshotValue.id) && generation === state.saveGeneration) {
				dependencies.publish('dirty');
			}
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

	function ownsWriteFence(projectId: string, writeFence: string | null): boolean {
		return !dependencies.isReadOnly()
			&& (!dependencies.getWriteFence || Boolean(writeFence && dependencies.getWriteFence(projectId) === writeFence));
	}
}

function createProjectSaveState<Project extends ProjectSaveSnapshot>(): ProjectSaveState<Project> {
	return {
		autosaveTimer: 0,
		saveGeneration: 0,
		pendingSaveSnapshots: new Set(),
		saveQueue: Promise.resolve(),
	};
}
