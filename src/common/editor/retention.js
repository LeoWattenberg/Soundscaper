/**
 * Source-retention helpers. Audio source metadata may outlive the last clip
 * that uses it, so reachability is intentionally derived from clips rather
 * than from a project's `sources` array.
 */

import {
	isFoundationProjectSchema,
	isSelectedFramescaperProjectSchema,
	isSoundscaperProductionProject,
} from './project-schema-version.ts';
import { collectTakeGroupSourceIds } from './take-group-source-references.ts';

const MAXIMUM_FRAMESCAPER_FINISHING_ASSET_ROOTS = 16_384;
const SHA256 = /^[a-f0-9]{64}$/u;

export function collectProjectSourceIds(project, target = new Set()) {
	if (!isFoundationProjectSchema(project)) return target;
	const clips = [
		...(project?.clips || []),
		...(project?.projectBin?.clips || []),
	];
	for (const clip of clips) {
		if (typeof clip?.sourceId === 'string' && clip.sourceId) target.add(clip.sourceId);
	}
	collectTakeGroupSourceIds(project, target);
	collectFeatureFallbackSourceIds(project, target);
	collectAssistanceAssetSourceIds(project, target);
	if (isSoundscaperProductionProject(project)) collectAudioTrackFreezeSourceIds(project, target);
	if (isSelectedFramescaperProjectSchema(project)) {
		collectMulticameraMemberSourceIds(project, target);
		collectVideoFreezeFallbackSourceIds(project, target);
		collectOpenFxFrozenFallbackSourceIds(project, target);
		collectVisualGraphInputSourceIds(project, target);
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
 * A visual graph consumes media the timeline never places: a mask matte's input,
 * an external generator's input, and an OpenFX named input each reach a source no
 * clip carries. A named input may also address a clip or a track, so only the
 * references that name an actual source are counted.
 */
function collectVisualGraphInputSourceIds(project, target) {
	const sources = Array.isArray(project?.sources) ? project.sources : [];
	const sourceIds = new Set(sources.map((source) => source?.id).filter((id) => typeof id === 'string' && id));
	if (sourceIds.size === 0) return;
	const collectInputs = (inputs) => {
		for (const input of Array.isArray(inputs) ? inputs : []) {
			const sourceRef = input?.sourceRef;
			if (typeof sourceRef === 'string' && sourceIds.has(sourceRef)) target.add(sourceRef);
		}
	};
	for (const graph of Array.isArray(project?.videoMaskMattes) ? project.videoMaskMattes : []) {
		collectInputs(graph?.inputs);
	}
	for (const effect of Array.isArray(project?.ofxEffects) ? project.ofxEffects : []) {
		collectInputs(effect?.inputs);
	}
	for (const source of sources) {
		if (source?.kind === 'generator') collectInputs(source?.generator?.inputs);
	}
}

/**
 * A frozen OpenFX fallback stands in for a native plugin that cannot run, and it
 * names external video media no clip reaches. Loading the project checks that the
 * media is still there and that its digest matches, so dropping it here would
 * leave a document that no longer opens.
 */
function collectOpenFxFrozenFallbackSourceIds(project, target) {
	const effects = Array.isArray(project?.ofxEffects) ? project.ofxEffects : [];
	for (const effect of effects) {
		const sourceId = effect?.frozenFallback?.externalMediaSourceId;
		if (typeof sourceId === 'string' && sourceId) target.add(sourceId);
	}
}

/** Assistance references keep their exact source authority alive without creating a clip. */
function collectAssistanceAssetSourceIds(project, target) {
	const assets = Array.isArray(project?.assistanceAssets) ? project.assistanceAssets : [];
	for (const asset of assets) {
		if (typeof asset?.sourceId === 'string' && asset.sourceId) target.add(asset.sourceId);
	}
}

/**
 * Collect content-addressed Framescaper finishing bodies without exposing a partial
 * result if an alias, malformed identity, or root bound is encountered.
 */
export function collectFramescaperProjectAssetStorageKeys(
	project,
	target = new Set(),
	{ maximumRoots = MAXIMUM_FRAMESCAPER_FINISHING_ASSET_ROOTS } = {},
) {
	if (!(target instanceof Set)) throw new TypeError('Framescaper finishing asset target must be a Set.');
	if (!Number.isSafeInteger(maximumRoots) || maximumRoots < 1
		|| maximumRoots > MAXIMUM_FRAMESCAPER_FINISHING_ASSET_ROOTS) {
		throw new RangeError('Framescaper finishing asset root limit is invalid.');
	}
	if (!isSelectedFramescaperProjectSchema(project)) return target;

	const identities = new Map();
	const add = (kind, value, expectedPrefix) => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new TypeError(`Framescaper ${kind} asset identity must be an object.`);
		}
		const storageKey = value.storageKey;
		const sha256 = value.sha256;
		const byteLength = value.byteLength;
		if (typeof storageKey !== 'string' || typeof sha256 !== 'string'
			|| !SHA256.test(sha256) || storageKey !== `${expectedPrefix}${sha256}`
			|| !Number.isSafeInteger(byteLength) || byteLength < 1) {
			throw new RangeError(`Framescaper ${kind} asset identity is not content-bound.`);
		}
		const identity = `${kind}\u0000${sha256}\u0000${String(byteLength)}`;
		const existing = identities.get(storageKey);
		if (existing !== undefined && existing !== identity) {
			throw new RangeError(`Framescaper finishing asset alias ${storageKey} has conflicting identity.`);
		}
		identities.set(storageKey, identity);
		if (identities.size > maximumRoots) {
			throw new RangeError('Framescaper finishing asset root limit was exceeded.');
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
	collectFramescaperProjectAssetStorageKeys(project, target);
	for (const asset of Array.isArray(project?.assistanceAssets) ? project.assistanceAssets : []) {
		const storageKey = asset?.body?.storageKey;
		if (typeof storageKey === 'string' && storageKey) target.add(storageKey);
	}
	return target;
}

function requiredArray(project, field) {
	const value = project?.[field];
	if (!Array.isArray(value)) throw new TypeError(`Framescaper ${field} must be an array.`);
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
