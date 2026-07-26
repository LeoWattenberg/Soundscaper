/* SPDX-License-Identifier: AGPL-3.0-only */

export interface RetentionClip extends Readonly<Record<string, unknown>> {
	readonly id: string;
}

export interface RetentionProject extends Readonly<Record<string, unknown>> {
	readonly id: string;
}

export interface RetentionHistory<Project extends RetentionProject> {
	readonly present: Project;
}

interface RetentionClipboard {
	readonly tracks?: readonly Readonly<{
		readonly clips?: readonly Readonly<{ readonly sourceId?: string | null }>[];
	}>[];
}

export interface ProjectRetentionState<History> {
	history: History | null;
	readonly clipboard: RetentionClipboard | null;
	readonly readOnly: boolean;
	readonly recordingSourceId: string | null;
}

interface RetentionSessionTab {
	readonly dirty: boolean;
}

interface RetentionSessionHistoryTab<History> {
	readonly history: History;
}

interface ClipRetentionCache {
	getProtectedSourceIds?(): Iterable<string>;
	retainClipIds?(clipIds: ReadonlySet<string>): void;
}

export interface ProjectRetentionServiceDependencies<
	Project extends RetentionProject,
	History extends RetentionHistory<Project>,
> {
	readonly state: ProjectRetentionState<History>;
	readonly getProject: () => Project | null;
	readonly setProject: (project: Project | null) => void;
	readonly compactHistory: (
		history: History,
		options: Readonly<{ preservePresentSourceIds: ReadonlySet<string> }>,
	) => History;
	readonly sessionTab: (projectId: string) => RetentionSessionTab | null;
	readonly updateProjectHistory: (
		projectId: string,
		history: History,
		options: Readonly<{ dirty: boolean }>,
	) => void;
	readonly getSourceReferenceCounts: () => Readonly<Record<string, number>>;
	readonly getSessionTabs: () => readonly RetentionSessionHistoryTab<History>[];
	readonly editorHistoryProjects: (history: History) => readonly Project[];
	readonly allProjectClips: (project: Project) => readonly RetentionClip[];
	readonly clipCache: ClipRetentionCache;
	readonly sourceBuffers: ReadonlyMap<string, unknown>;
	readonly sourcePeaks: ReadonlyMap<string, unknown>;
	readonly evictSourceCaches: (
		sourceBuffers: ReadonlyMap<string, unknown>,
		sourcePeaks: ReadonlyMap<string, unknown>,
		retainedSourceIds: ReadonlySet<string>,
	) => void;
}

export interface ProjectRetentionService<Project extends RetentionProject> {
	clipboardSourceIds(): ReadonlySet<string>;
	compactLiveSourceState(dirty?: boolean | null): Project | null;
	liveSessionSourceIds(): Set<string>;
	liveSessionClipIds(): Set<string>;
	retainLiveClipIds(): void;
}

/** Owns all roots that keep source metadata, PCM, peaks, and render caches live. */
export function createProjectRetentionService<
	Project extends RetentionProject,
	History extends RetentionHistory<Project>,
>(
	dependencies: ProjectRetentionServiceDependencies<Project, History>,
): Readonly<ProjectRetentionService<Project>> {
	return Object.freeze({
		clipboardSourceIds,
		compactLiveSourceState,
		liveSessionSourceIds,
		liveSessionClipIds,
		retainLiveClipIds,
	});

	function clipboardSourceIds(): ReadonlySet<string> {
		const sourceIds = new Set<string>();
		for (const clipboardTrack of dependencies.state.clipboard?.tracks || []) {
			for (const clip of clipboardTrack.clips || []) {
				if (clip.sourceId) sourceIds.add(clip.sourceId);
			}
		}
		return sourceIds;
	}

	function compactLiveSourceState(dirty: boolean | null = null): Project | null {
		const currentHistory = dependencies.state.history;
		const nextHistory = currentHistory
			? dependencies.compactHistory(currentHistory, {
				preservePresentSourceIds: clipboardSourceIds(),
			})
			: null;
		dependencies.state.history = nextHistory;
		const project = nextHistory?.present ?? null;
		dependencies.setProject(project);
		if (project && nextHistory && !dependencies.state.readOnly) {
			const tab = dependencies.sessionTab(project.id);
			if (tab) {
				dependencies.updateProjectHistory(project.id, nextHistory, {
					dirty: dirty == null ? tab.dirty : Boolean(dirty),
				});
			}
		}
		dependencies.evictSourceCaches(
			dependencies.sourceBuffers,
			dependencies.sourcePeaks,
			liveSessionSourceIds(),
		);
		return project;
	}

	function liveSessionSourceIds(): Set<string> {
		const sourceIds = new Set(Object.keys(dependencies.getSourceReferenceCounts()));
		if (dependencies.state.recordingSourceId) sourceIds.add(dependencies.state.recordingSourceId);
		for (const sourceId of dependencies.clipCache.getProtectedSourceIds?.() || []) {
			sourceIds.add(sourceId);
		}
		return sourceIds;
	}

	function liveSessionClipIds(): Set<string> {
		const clipIds = new Set<string>();
		for (const tab of dependencies.getSessionTabs()) {
			for (const project of dependencies.editorHistoryProjects(tab.history)) {
				for (const clip of dependencies.allProjectClips(project)) clipIds.add(clip.id);
			}
		}
		return clipIds;
	}

	function retainLiveClipIds(): void {
		dependencies.clipCache.retainClipIds?.(liveSessionClipIds());
	}
}
