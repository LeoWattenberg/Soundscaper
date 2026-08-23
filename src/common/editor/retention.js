/**
 * Source-retention helpers. Audio source metadata may outlive the last clip
 * that uses it, so reachability is intentionally derived from clips rather
 * than from a project's `sources` array.
 */

import { AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION } from './project-schema-version.ts';
import { collectTakeGroupSourceIds } from './take-group-source-references.ts';

/** Product schemas are not importable from common, so V18 is named here. */
const FRAMESCAPER_MULTICAMERA_SCHEMA_VERSION = 18;
const FRAMESCAPER_VISUAL_SCHEMA_VERSION = 24;
const FRAMESCAPER_FINISHING_SCHEMA_VERSION = 27;
const SOUNDSCAPER_PRODUCTION_SCHEMA_VERSION = 21;
const MAXIMUM_FRAMESCAPER_FINISHING_ASSET_ROOTS = 16_384;
const SHA256 = /^[a-f0-9]{64}$/u;

/**
 * A schema only ever adds reference kinds, so each walk is gated on the
 * earliest schema that can carry it. Gating on one exact version leaves every
 * later document unrooted, and compaction then deletes the media it names.
 */
const SOURCE_REFERENCE_WALKS = [
	{ since: AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION, collect: collectTakeGroupSourceIds },
	{ since: AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION, collect: collectFeatureFallbackSourceIds },
	{ since: FRAMESCAPER_MULTICAMERA_SCHEMA_VERSION, collect: collectMulticameraMemberSourceIds },
	{ since: SOUNDSCAPER_PRODUCTION_SCHEMA_VERSION, collect: collectAudioTrackFreezeSourceIds },
	{ since: FRAMESCAPER_VISUAL_SCHEMA_VERSION, collect: collectVideoFreezeFallbackSourceIds },
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

/** Preserve a freeze render even while a stale relationship is fail-closed. */
function collectAudioTrackFreezeSourceIds(project, target) {
	const tracks = Array.isArray(project?.tracks) ? project.tracks : [];
	for (const track of tracks) {
		const sourceId = track?.audioFreeze?.derivedSourceId;
		if (typeof sourceId === 'string' && sourceId) target.add(sourceId);
	}
}

/** Preserve Framescaper picture freezes even when no ordinary clip names the render. */
function collectVideoFreezeFallbackSourceIds(project, target) {
	const freezes = Array.isArray(project?.videoFreezeFallbacks) ? project.videoFreezeFallbacks : [];
	for (const freeze of freezes) {
		const sourceId = freeze?.renderedSourceId;
		if (typeof sourceId === 'string' && sourceId) target.add(sourceId);
	}
}

/**
 * Collect content-addressed V27 finishing bodies without exposing a partial
 * result if an alias, malformed identity, or root bound is encountered.
 */
export function collectFramescaperProjectAssetStorageKeysV27(
	project,
	target = new Set(),
	{ maximumRoots = MAXIMUM_FRAMESCAPER_FINISHING_ASSET_ROOTS } = {},
) {
	if (!(target instanceof Set)) throw new TypeError('V27 finishing asset target must be a Set.');
	if (!Number.isSafeInteger(maximumRoots) || maximumRoots < 1
		|| maximumRoots > MAXIMUM_FRAMESCAPER_FINISHING_ASSET_ROOTS) {
		throw new RangeError('V27 finishing asset root limit is invalid.');
	}
	if (project?.schemaVersion !== FRAMESCAPER_FINISHING_SCHEMA_VERSION) return target;

	const identities = new Map();
	const add = (kind, value, expectedPrefix) => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new TypeError(`V27 ${kind} asset identity must be an object.`);
		}
		const storageKey = value.storageKey;
		const sha256 = value.sha256;
		const byteLength = value.byteLength;
		if (typeof storageKey !== 'string' || typeof sha256 !== 'string'
			|| !SHA256.test(sha256) || storageKey !== `${expectedPrefix}${sha256}`
			|| !Number.isSafeInteger(byteLength) || byteLength < 1) {
			throw new RangeError(`V27 ${kind} asset identity is not content-bound.`);
		}
		const identity = `${kind}\u0000${sha256}\u0000${String(byteLength)}`;
		const existing = identities.get(storageKey);
		if (existing !== undefined && existing !== identity) {
			throw new RangeError(`V27 finishing asset alias ${storageKey} has conflicting identity.`);
		}
		identities.set(storageKey, identity);
		if (identities.size > maximumRoots) {
			throw new RangeError('V27 finishing asset root limit was exceeded.');
		}
	};

	for (const analysis of requiredArray(project, 'videoMotionAnalyses')) {
		add('motion', analysis, 'motion-sha256:');
	}
	for (const presentation of requiredArray(project, 'videoVisualPresentations')) {
		const lut = presentation?.grade?.lut;
		if (lut !== null && lut !== undefined) add('LUT', lut, 'lut-sha256:');
	}
	for (const preset of requiredArray(project, 'videoFinishingPresets')) {
		const lut = preset?.template?.grade?.lut;
		if (lut !== null && lut !== undefined) add('LUT', lut, 'lut-sha256:');
	}
	for (const storageKey of identities.keys()) target.add(storageKey);
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
		const proxyStorageKey = source?.proxyAttachment?.storageKey;
		if (typeof proxyStorageKey === 'string' && proxyStorageKey) target.add(proxyStorageKey);
		const proxyTimingStorageKey = source?.proxyAttachment?.timingAsset?.storageKey;
		if (typeof proxyTimingStorageKey === 'string' && proxyTimingStorageKey) target.add(proxyTimingStorageKey);
	}
	collectFramescaperProjectAssetStorageKeysV27(project, target);
	return target;
}

function requiredArray(project, field) {
	const value = project?.[field];
	if (!Array.isArray(value)) throw new TypeError(`V27 ${field} must be an array.`);
	return value;
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
