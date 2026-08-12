/**
 * Source-retention helpers. Audio source metadata may outlive the last clip
 * that uses it, so reachability is intentionally derived from clips rather
 * than from a project's `sources` array.
 */

import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from './project-schema-version.ts';
import { collectTakeGroupSourceIds } from './take-group-source-references.ts';

export function collectProjectSourceIds(project, target = new Set()) {
	const clips = [
		...(project?.clips || []),
		...(project?.projectBin?.clips || []),
	];
	for (const clip of clips) {
		if (typeof clip?.sourceId === 'string' && clip.sourceId) target.add(clip.sourceId);
	}
	if (project?.schemaVersion === AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		collectTakeGroupSourceIds(project, target);
		const requirements = project.featureRequirements?.requirements;
		if (Array.isArray(requirements)) {
			for (const requirement of requirements) {
				const sourceId = requirement?.fallback?.sourceId;
				if (typeof sourceId === 'string' && sourceId) target.add(sourceId);
			}
		}
	}
	return target;
}

/** Resolve durable logical references to the keys used by source/media stores. */
export function collectProjectStorageKeys(project, target = new Set()) {
	const sources = Array.isArray(project?.sources) ? project.sources : [];
	const sourceById = new Map(sources.map((source) => [source?.id, source]));
	for (const sourceId of collectProjectSourceIds(project)) {
		const source = sourceById.get(sourceId);
		const storageKey = source?.storageKey;
		target.add(typeof storageKey === 'string' && storageKey ? storageKey : sourceId);
		const timingStorageKey = source?.timingAsset?.storageKey;
		if (typeof timingStorageKey === 'string' && timingStorageKey) target.add(timingStorageKey);
	}
	return target;
}

export function editorHistoryProjects(history) {
	if (!history) return [];
	return [
		history.present,
		...(history.undoStack || []).map((entry) => entry.project),
		...(history.redoStack || []).map((entry) => entry.project),
	].filter(Boolean);
}

export function collectHistorySourceIds(history, target = new Set()) {
	for (const project of editorHistoryProjects(history)) collectProjectSourceIds(project, target);
	return target;
}

/**
 * Remove metadata that no clip in this snapshot can reach. Extra ids are only
 * useful for the live project (for example, a cut clipboard); saved snapshots
 * do not persist editor-session state.
 */
export function compactProjectSourceMetadata(project, { preserveSourceIds = [] } = {}) {
	if (!project || !Array.isArray(project.sources) || !Array.isArray(project.clips)) return project;
	const retained = collectProjectSourceIds(project);
	for (const sourceId of preserveSourceIds) if (sourceId) retained.add(sourceId);
	const sources = project.sources.filter((source) => retained.has(source?.id));
	return sources.length === project.sources.length ? project : { ...project, sources };
}

export function compactEditorHistorySourceMetadata(history, { preservePresentSourceIds = [] } = {}) {
	if (!history) return history;
	let changed = false;
	const compact = (project, preserveSourceIds = []) => {
		const next = compactProjectSourceMetadata(project, { preserveSourceIds });
		if (next !== project) changed = true;
		return next;
	};
	const present = compact(history.present, preservePresentSourceIds);
	const undoStack = (history.undoStack || []).map((entry) => {
		const project = compact(entry.project);
		return project === entry.project ? entry : { ...entry, project };
	});
	const redoStack = (history.redoStack || []).map((entry) => {
		const project = compact(entry.project);
		return project === entry.project ? entry : { ...entry, project };
	});
	return changed ? { ...history, present, undoStack, redoStack } : history;
}

export function evictUnreferencedSourceCaches(sourceBuffers, sourcePeaks, retainedSourceIds) {
	const retained = retainedSourceIds instanceof Set ? retainedSourceIds : new Set(retainedSourceIds || []);
	const evicted = new Set();
	for (const cache of [sourceBuffers, sourcePeaks]) {
		if (!cache?.keys || !cache?.delete) continue;
		for (const sourceId of cache.keys()) {
			if (retained.has(sourceId)) continue;
			cache.delete(sourceId);
			evicted.add(sourceId);
		}
	}
	return [...evicted];
}
