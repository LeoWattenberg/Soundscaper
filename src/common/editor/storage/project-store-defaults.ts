/* SPDX-License-Identifier: AGPL-3.0-only */

export function createProjectStoreId(prefix: string): string {
	if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function reportDesktopProjectLocalCleanupError(): void {
	globalThis.console?.error?.('A deleted desktop project could not be removed from this product local cache.');
}

interface ProjectDuplicationStore<Result> {
	readonly linkedOriginalStoreService: Readonly<{
		duplicateProject(ports: Readonly<{
			loadProject(projectId: string): Promise<unknown>;
			listProjects(): Promise<unknown>;
			createProjectIfAbsent(project: unknown): Promise<unknown>;
		}>, request: Readonly<{
			readonly sourceProjectId: string;
			readonly copyProjectId: string;
			readonly title: unknown;
			readonly timestamp: string;
		}>): Promise<Result>;
	}>;
	readonly projectRepository: Readonly<Record<string, unknown>>;
	loadProject(projectId: string): Promise<unknown>;
	listProjects(): Promise<unknown>;
	createProjectIfAbsent(project: unknown): Promise<unknown>;
}

/** Store-level project duplication entry shared by the browser and desktop repositories. */
export function duplicateStoreProject<Result>(
	store: ProjectDuplicationStore<Result>,
	projectId: string,
	{ id, title }: Readonly<{ id?: string; title?: unknown }> = {},
): Promise<Result> {
	const repository = store.projectRepository as Readonly<{
		loadProjectForDuplication?(projectId: string): Promise<unknown>;
	}>;
	return store.linkedOriginalStoreService.duplicateProject({
		loadProject: (requestedId) => typeof repository.loadProjectForDuplication === 'function'
			? repository.loadProjectForDuplication(requestedId)
			: store.loadProject(requestedId),
		listProjects: () => store.listProjects(),
		createProjectIfAbsent: (project) => store.createProjectIfAbsent(project),
	}, {
		sourceProjectId: projectId,
		copyProjectId: id || createProjectStoreId('project'),
		title,
		timestamp: new Date().toISOString(),
	});
}
