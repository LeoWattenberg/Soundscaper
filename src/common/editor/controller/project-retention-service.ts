/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from '../code-unit-order.ts';
import type { ProjectLinkedOriginalSourceReference } from '../storage/project-publication-options.ts';
import {
	collectTakeGroupSourceIds,
	type TakeGroupSourceReferenceProject,
} from '../take-group-source-references.ts';

export interface RetentionClip extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly sourceId?: string | null;
	readonly kind?: unknown;
}

export interface RetentionProject extends Readonly<Record<string, unknown>>, TakeGroupSourceReferenceProject {
	readonly id: string;
	readonly sources?: readonly Readonly<{
		readonly id: string;
		readonly kind?: unknown;
	}>[];
	readonly featureRequirements?: Readonly<{
		readonly requirements?: readonly Readonly<{
			readonly fallback?: Readonly<{
				readonly kind?: unknown;
				readonly sourceId?: string | null;
			}> | null;
		}>[];
	}>;
	readonly assistanceAssets?: readonly Readonly<{
		readonly sourceId?: string | null;
	}>[];
}

export interface RetentionHistory<Project extends RetentionProject> {
	readonly present: Project;
}

interface RetentionClipboard {
	readonly tracks?: readonly Readonly<{
		readonly sourceTrackType?: 'audio' | 'video';
		readonly clips?: readonly Readonly<{
			readonly sourceId?: string | null;
			readonly kind?: unknown;
		}>[];
	}>[];
}

export interface ProjectRetentionState<History> {
	history: History | null;
	readonly clipboard: RetentionClipboard | null;
	readonly readOnly: boolean;
	readonly recordingSourceId: string | null;
}

interface RetentionSessionTab<History> {
	readonly dirty: boolean;
	readonly history?: History;
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
	readonly sessionTab: (projectId: string) => RetentionSessionTab<History> | null;
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
	readonly getProtectedSourceIds?: () => Iterable<string>;
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
	liveSessionLinkedOriginalSourceReferences(): readonly ProjectLinkedOriginalSourceReference[];
	liveSessionSourceIds(): Set<string>;
	liveSessionClipIds(): Set<string>;
	retainLiveClipIds(): void;
	synchronizeLiveHistory<History extends RetentionHistory<Project>>(history: History): History;
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
		liveSessionLinkedOriginalSourceReferences,
		liveSessionSourceIds,
		liveSessionClipIds,
		retainLiveClipIds,
		synchronizeLiveHistory,
	});

	function synchronizeLiveHistory<NextHistory extends RetentionHistory<Project>>(
		nextHistory: NextHistory,
	): NextHistory {
		const projectId = nextHistory.present.id;
		const tab = dependencies.sessionTab(projectId);
		if (!tab) throw new Error('The active project session history is unavailable.');
		dependencies.updateProjectHistory(projectId, nextHistory as unknown as History, { dirty: tab.dirty });
		const synchronized = dependencies.sessionTab(projectId)?.history;
		if (!synchronized) throw new Error('The synchronized project session history is unavailable.');
		return synchronized as unknown as NextHistory;
	}

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
				preservePresentSourceIds: retainedSourceIds(
					currentHistory.present, clipboardSourceIds(),
				),
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
		for (const tab of dependencies.getSessionTabs()) {
			for (const project of dependencies.editorHistoryProjects(tab.history)) {
				for (const sourceId of assistanceSourceIds(project)) sourceIds.add(sourceId);
			}
		}
		for (const sourceId of transientAudioSourceIds()) sourceIds.add(sourceId);
		for (const sourceId of dependencies.getProtectedSourceIds?.() || []) sourceIds.add(sourceId);
		return sourceIds;
	}

	function liveSessionLinkedOriginalSourceReferences(): readonly ProjectLinkedOriginalSourceReference[] {
		const transientAudioIds = transientAudioSourceIds();
		const references = new Map<string, ProjectLinkedOriginalSourceReference>();
		const add = (kind: 'audio' | 'video', sourceId: string | null | undefined) => {
			if (!sourceId) return;
			const reference = Object.freeze({ kind, sourceId });
			references.set(`${kind}:${sourceId}`, reference);
		};
		for (const tab of dependencies.getSessionTabs()) {
			for (const project of dependencies.editorHistoryProjects(tab.history)) {
				const sourceById = new Map((project.sources || []).map((source) => [source.id, source]));
				const sourceKind = (sourceId: string): 'audio' | 'video' | null => {
					const kind = sourceById.get(sourceId)?.kind;
					return kind === undefined || kind === 'audio' ? 'audio' : kind === 'video' ? 'video' : null;
				};
				for (const clip of dependencies.allProjectClips(project)) {
					if (!clip.sourceId) continue;
					const kind = linkedOriginalKind(clip.kind)
						?? (clip.kind === undefined ? sourceKind(clip.sourceId) : null);
					if (kind) add(kind, clip.sourceId);
				}
				for (const requirement of project.featureRequirements?.requirements || []) {
					const fallback = requirement.fallback;
					if (!fallback?.sourceId) continue;
					const kind = linkedOriginalKind(fallback.kind)
						?? (fallback.kind === undefined ? sourceKind(fallback.sourceId) : null);
					if (kind) add(kind, fallback.sourceId);
				}
				for (const sourceId of collectTakeGroupSourceIds(project)) {
					const kind = sourceKind(sourceId);
					if (kind) add(kind, sourceId);
				}
				for (const sourceId of assistanceSourceIds(project)) {
					const kind = sourceKind(sourceId);
					if (kind) add(kind, sourceId);
				}
			}
		}
		for (const track of dependencies.state.clipboard?.tracks || []) {
			for (const clip of track.clips || []) {
				const kind = linkedOriginalKind(clip.kind)
					?? (clip.kind === undefined ? track.sourceTrackType ?? 'audio' : null);
				if (kind) add(kind, clip.sourceId);
			}
		}
		for (const sourceId of transientAudioIds) add('audio', sourceId);
		return Object.freeze([...references.values()].sort((left, right) => (
			compareCodeUnits(left.kind, right.kind) || compareCodeUnits(left.sourceId, right.sourceId)
		)));
	}

	function transientAudioSourceIds(): Set<string> {
		const sourceIds = new Set<string>();
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

function retainedSourceIds(
	project: RetentionProject,
	initial: ReadonlySet<string>,
): ReadonlySet<string> {
	return new Set([...initial, ...assistanceSourceIds(project)]);
}

function assistanceSourceIds(project: RetentionProject): readonly string[] {
	return (project.assistanceAssets ?? []).flatMap((asset) => (
		typeof asset.sourceId === 'string' && asset.sourceId ? [asset.sourceId] : []
	));
}

function linkedOriginalKind(value: unknown): 'audio' | 'video' | null {
	return value === 'audio' || value === 'video' ? value : null;
}
