/**
 * Source-retention helpers. Audio source metadata may outlive the last clip
 * that uses it, so reachability is intentionally derived from clips rather
 * than from a project's `sources` array.
 */

import { AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION } from './project-schema-version.ts';
import { collectTakeGroupSourceIds } from './take-group-source-references.ts';

/** Product schemas are not importable from common, so V18 is named here. */
const FRAMESCAPER_MULTICAMERA_SCHEMA_VERSION = 18;

/**
 * A schema only ever adds reference kinds, so each walk is gated on the
 * earliest schema that can carry it. Gating on one exact version leaves every
 * later document unrooted, and compaction then deletes the media it names.
 */
const SOURCE_REFERENCE_WALKS = [
	{ since: AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION, collect: collectTakeGroupSourceIds },
	{ since: AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION, collect: collectFeatureFallbackSourceIds },
	{ since: FRAMESCAPER_MULTICAMERA_SCHEMA_VERSION, collect: collectMulticameraMemberSourceIds },
];

export function collectProjectSourceIds(project, target = new Set()) {
	const clips = [
		...(project?.clips || []),
		...(project?.projectBin?.clips || []),
	];
	for (const clip of clips) {
		if (typeof clip?.sourceId === 'string' && clip.sourceId) target.add(clip.sourceId);
	}
	const schemaVersion = typeof project?.schemaVersion === 'number' ? project.schemaVersion : 0;
	for (const { since, collect } of SOURCE_REFERENCE_WALKS) {
		if (schemaVersion >= since) collect(project, target);
	}
	return target;
}

/** Rendered fallbacks own render media that no clip in the document reaches. */
function collectFeatureFallbackSourceIds(project, target) {
	const requirements = project?.featureRequirements?.requirements;
	if (!Array.isArray(requirements)) return;
	for (const requirement of requirements) {
		const sourceId = requirement?.fallback?.sourceId;
		if (typeof sourceId === 'string' && sourceId) target.add(sourceId);
	}
}

/** Preserve opaque Framescaper V18 member media without activating its graph. */
function collectMulticameraMemberSourceIds(project, target) {
	const groups = Array.isArray(project?.multicameraGroups) ? project.multicameraGroups : [];
	for (const group of groups) {
		const members = Array.isArray(group?.members) ? group.members : [];
		for (const member of members) {
			if (typeof member?.sourceId === 'string' && member.sourceId) target.add(member.sourceId);
		}
	}
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
