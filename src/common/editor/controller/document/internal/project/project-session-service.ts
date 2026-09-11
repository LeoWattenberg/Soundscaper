import {
	createProjectSessionSelectionService,
	type ProjectSessionSelectionMetadata,
	type ProjectSessionSelectionProject,
	type ProjectSessionSelectionServiceDependencies,
	type ProjectSessionSelectionState,
} from './project-session-selection-service.ts';

export type ProjectSessionGuard = <Value>(value: PromiseLike<Value> | Value) => Promise<Value>;

export interface ProjectSessionProject extends ProjectSessionSelectionProject {
	readonly id: string;
}

export interface ProjectSessionTab {
	readonly projectId: string;
	readonly metadata?: Record<string, unknown>;
	readonly [key: string]: unknown;
}

export interface ProjectSessionServiceDependencies<
	Project extends ProjectSessionProject,
	Tab extends ProjectSessionTab = ProjectSessionTab,
> {
	readonly productId: string;
	readonly recentProjectsSettingKey: string;
	readonly lastProjectSettingKey: string;
	readonly getRecentProjectIds: () => string[];
	readonly setRecentProjectIds: (projectIds: string[]) => void;
	readonly getActiveProjectId: () => string | null;
	readonly getActiveProject: () => Project | null;
	readonly state: ProjectSessionSelectionState;
	readonly findTrack: ProjectSessionSelectionServiceDependencies<Project>['findTrack'];
	readonly findClip: ProjectSessionSelectionServiceDependencies<Project>['findClip'];
	readonly getTabs: () => readonly Tab[];
	readonly updateProjectMetadata: (projectId: string, metadata: Record<string, unknown>) => void;
	readonly loadSetting: (key: string, fallback: unknown) => Promise<unknown>;
	readonly persistSetting: (key: string, value: unknown) => Promise<unknown>;
	readonly publish: () => void;
}

export function createProjectSessionService<
	Project extends ProjectSessionProject,
	Tab extends ProjectSessionTab = ProjectSessionTab,
>(
	dependencies: ProjectSessionServiceDependencies<Project, Tab>,
) {
	const projectSelection = createProjectSessionSelectionService(dependencies);
	return Object.freeze({
		sessionTab,
		persistActiveSessionUiState,
		setTrackChannelHeightRatio,
		restoreProjectSelection,
		loadRecentProjectState,
		recordOpenedProject,
		clearRecentProjects,
	});

	function sessionTab(projectId: string | null | undefined): Tab | null {
		if (!projectId) return null;
		return dependencies.getTabs().find((tab) => tab.projectId === projectId) || null;
	}

	function persistActiveSessionUiState(): void {
		const projectId = dependencies.getActiveProjectId();
		if (!projectId || !sessionTab(projectId)) return;
		dependencies.updateProjectMetadata(projectId, { ...projectSelection.capture() });
	}

	function setTrackChannelHeightRatio(trackId: unknown, requestedRatio: unknown): number {
		const project = dependencies.getActiveProject();
		if (!project || typeof trackId !== 'string' || !dependencies.findTrack(project, trackId)) {
			throw new ReferenceError(`Unknown track: ${String(trackId)}.`);
		}
		const ratio = Number(requestedRatio);
		if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) {
			throw new RangeError('Stereo channel height ratio must be between zero and one.');
		}
		const tab = sessionTab(project.id);
		if (!tab) throw new ReferenceError(`Unknown project tab: ${project.id}.`);
		const current = admittedTrackChannelHeightRatios(tab.metadata?.trackChannelHeightRatios, project);
		dependencies.updateProjectMetadata(project.id, {
			trackChannelHeightRatios: { ...current, [trackId]: ratio },
		});
		dependencies.publish();
		return ratio;
	}

	function restoreProjectSelection(
		project: Project,
		metadata: Readonly<ProjectSessionSelectionMetadata> = {},
	): void {
		projectSelection.restore(project, metadata);
	}

	async function loadRecentProjectState(guard: ProjectSessionGuard): Promise<string | null> {
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
		let lastProjectId = admittedProjectId(await guard(dependencies.loadSetting(dependencies.lastProjectSettingKey, null)));
		if (!lastProjectId && dependencies.productId === 'soundscaper') {
			lastProjectId = admittedProjectId(await guard(dependencies.loadSetting('last-project-id', null)));
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

function admittedTrackChannelHeightRatios(
	value: unknown,
	project: ProjectSessionProject,
): Record<string, number> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	const trackIds = new Set(project.tracks.map(({ id }) => id));
	return Object.fromEntries(Object.entries(value).filter(([trackId, ratio]) => (
		trackIds.has(trackId) && typeof ratio === 'number' && Number.isFinite(ratio)
		&& ratio > 0 && ratio < 1
	)));
}

function admittedProjectId(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}
