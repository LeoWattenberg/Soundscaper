export type ProjectSessionGuard = <Value>(value: PromiseLike<Value> | Value) => Promise<Value>;

export interface ProjectSessionTab {
	readonly projectId: string;
	readonly metadata?: Record<string, unknown>;
	readonly [key: string]: unknown;
}

export interface ProjectSessionServiceDependencies {
	readonly productId: string;
	readonly recentProjectsSettingKey: string;
	readonly lastProjectSettingKey: string;
	readonly getRecentProjectIds: () => string[];
	readonly setRecentProjectIds: (projectIds: string[]) => void;
	readonly getActiveProjectId: () => string | null;
	readonly getSelectedTrackId: () => string | null;
	readonly getSelectedClipId: () => string | null;
	readonly getTabs: () => ProjectSessionTab[];
	readonly updateProjectMetadata: (projectId: string, metadata: Record<string, unknown>) => void;
	readonly loadSetting: (key: string, fallback: unknown) => Promise<unknown>;
	readonly persistSetting: (key: string, value: unknown) => Promise<unknown>;
	readonly publish: () => void;
}

export function createProjectSessionService(dependencies: ProjectSessionServiceDependencies) {
	return Object.freeze({
		sessionTab,
		persistActiveSessionUiState,
		loadRecentProjectState,
		recordOpenedProject,
		clearRecentProjects,
	});

	function sessionTab(projectId: string | null | undefined): ProjectSessionTab | null {
		if (!projectId) return null;
		return dependencies.getTabs().find((tab) => tab.projectId === projectId) || null;
	}

	function persistActiveSessionUiState(): void {
		const projectId = dependencies.getActiveProjectId();
		if (!projectId || !sessionTab(projectId)) return;
		dependencies.updateProjectMetadata(projectId, {
			selectedTrackId: dependencies.getSelectedTrackId(),
			selectedClipId: dependencies.getSelectedClipId(),
		});
	}

	async function loadRecentProjectState(guard: ProjectSessionGuard): Promise<unknown> {
		let storedRecentProjectIds = await guard(dependencies.loadSetting(dependencies.recentProjectsSettingKey, null));
		if (!storedRecentProjectIds && dependencies.productId === 'soundscaper') {
			storedRecentProjectIds = await guard(dependencies.loadSetting('audio-editor-recent-project-ids', []));
		}
		storedRecentProjectIds ||= [];
		dependencies.setRecentProjectIds(Array.isArray(storedRecentProjectIds)
			? [...new Set(storedRecentProjectIds.filter((projectId): projectId is string => (
				typeof projectId === 'string' && Boolean(projectId)
			)))]
			: []);
		let lastProjectId = await guard(dependencies.loadSetting(dependencies.lastProjectSettingKey, null));
		if (!lastProjectId && dependencies.productId === 'soundscaper') {
			lastProjectId = await guard(dependencies.loadSetting('last-project-id', null));
		}
		return lastProjectId;
	}

	async function recordOpenedProject(projectId: string, guard: ProjectSessionGuard): Promise<string[]> {
		await guard(dependencies.persistSetting(dependencies.lastProjectSettingKey, projectId));
		if (dependencies.productId === 'soundscaper') {
			await guard(dependencies.persistSetting('last-project-id', projectId));
		}
		const recentProjectIds = [
			projectId,
			...dependencies.getRecentProjectIds().filter((candidate) => candidate !== projectId),
		].slice(0, 20);
		dependencies.setRecentProjectIds(recentProjectIds);
		await guard(dependencies.persistSetting(dependencies.recentProjectsSettingKey, recentProjectIds));
		if (dependencies.productId === 'soundscaper') {
			await guard(dependencies.persistSetting('audio-editor-recent-project-ids', recentProjectIds));
		}
		return recentProjectIds;
	}

	async function clearRecentProjects(): Promise<string[]> {
		const recentProjectIds: string[] = [];
		dependencies.setRecentProjectIds(recentProjectIds);
		await dependencies.persistSetting(dependencies.recentProjectsSettingKey, recentProjectIds);
		if (dependencies.productId === 'soundscaper') {
			await dependencies.persistSetting('audio-editor-recent-project-ids', recentProjectIds);
		}
		dependencies.publish();
		return recentProjectIds;
	}
}
