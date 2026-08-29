/* SPDX-License-Identifier: AGPL-3.0-only */

interface StoredProject {
	readonly id: string;
}

interface StoredProjectTab<Project extends StoredProject> {
	readonly history: Readonly<{ readonly present: Project }>;
}

export interface StoredProjectOpenRuntime<Project extends StoredProject> {
	readonly copy: Readonly<{ readonly projectNotFound: string }>;
	readonly state: Readonly<{
		readonly recentProjectIds: readonly string[];
		readonly projects: readonly Readonly<{ readonly id: string }>[];
	}>;
	readonly store: Readonly<{ loadProject(projectId: string): Promise<Project | null> }>;
	sessionTab(projectId: string): StoredProjectTab<Project> | null;
	switchProject(project: Project): PromiseLike<unknown> | unknown;
	openProject(project: Project): PromiseLike<unknown> | unknown;
}

/** Owns the intent spanning asynchronous stored-project loads. */
export function createStoredProjectOpenActions<Project extends StoredProject>(
	runtime: StoredProjectOpenRuntime<Project>,
) {
	let requestGeneration = 0;

	async function activate(projectId: string): Promise<unknown> {
		const generation = ++requestGeneration;
		const openTab = runtime.sessionTab(projectId);
		if (openTab) return runtime.switchProject(openTab.history.present);
		const saved = await runtime.store.loadProject(projectId);
		if (generation !== requestGeneration) return null;
		if (!saved) throw new Error(runtime.copy.projectNotFound);
		return runtime.openProject(saved);
	}

	return Object.freeze({
		async openRecent(projectId: string | null = null): Promise<unknown> {
			if (projectId === null) {
				return runtime.state.recentProjectIds
					.map((id) => runtime.state.projects.find((candidate) => candidate.id === id))
					.filter(Boolean);
			}
			if (!runtime.state.recentProjectIds.includes(projectId)) {
				throw new Error(runtime.copy.projectNotFound);
			}
			return activate(projectId);
		},
		openById: activate,
	});
}
