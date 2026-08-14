/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	isProjectFeatureAudioCapabilityId,
	isProjectFeatureCapabilityId,
	isProjectFeatureVideoCapabilityId,
	PROJECT_FEATURE_CAPABILITY_IDS,
} from './project-feature-capabilities.ts';
import type {
	EvaluateProjectFeatureRequirementsOptions,
	NormalizeProjectFeatureRequirementsOptions,
	ProjectFeatureAvailability,
	ProjectFeatureEffectiveDisposition,
	ProjectFeatureFallback,
	ProjectFeatureFallbackKind,
	ProjectFeatureFallbackRole,
	ProjectFeatureRequirementsManifest,
	ProjectFeatureRequirementsReport,
	ProjectFeatureRequirementsReportItem,
	ProjectSourceReference,
	ProjectTimelineClipReference,
	ProjectTrackReference,
} from './project-feature-requirement-types.ts';
import { normalizeVideoEffects } from './video-effects.js';
import { resolveRuntimeClipProjection } from './runtime-clip-projection.ts';
import { normalizeAudioTrackFreezeV1 } from './audio-track-freeze-v21.ts';

export type {
	EvaluateProjectFeatureRequirementsOptions,
	NormalizeProjectFeatureRequirementsOptions,
	ProjectFeatureAudioMixFallback,
	ProjectFeatureAudioTrackRenderFallback,
	ProjectFeatureAvailability,
	ProjectFeatureEffectiveDisposition,
	ProjectFeatureFallback,
	ProjectFeatureFallbackKind,
	ProjectFeatureFallbackRole,
	ProjectFeatureRequirement,
	ProjectFeatureRequirementDisposition,
	ProjectFeatureRequirementsManifest,
	ProjectFeatureRequirementsReport,
	ProjectFeatureRequirementsReportItem,
	ProjectFeatureVideoClipRenderFallback,
	ProjectFeatureVideoRenderFallback,
} from './project-feature-requirement-types.ts';

export const PROJECT_FEATURE_REQUIREMENTS_SCHEMA_VERSION = 2;
export const PROJECT_FEATURE_REQUIREMENTS_LIMITS = Object.freeze({
	maximumRequirements: 1_024,
	maximumRequirementIdLength: 128,
	maximumFeatureIdLength: 256,
	maximumDisplayNameLength: 256,
	maximumSourceIdLength: 256,
});

const MANIFEST_KEYS = new Set(['schemaVersion', 'requirements']);
const REQUIREMENT_KEYS = new Set(['id', 'featureId', 'displayName', 'disposition', 'fallback']);
const FALLBACK_V1_KEYS = new Set(['kind', 'sourceId', 'sha256']);
const FALLBACK_V2_KEYS = new Set(['role', 'kind', 'sourceId', 'sha256']);
const CLIP_FALLBACK_V2_KEYS = new Set([...FALLBACK_V2_KEYS, 'targetClipId']);
const TRACK_FALLBACK_V2_KEYS = new Set([...FALLBACK_V2_KEYS, 'targetTrackId']);
const REQUIREMENT_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/u;
const FEATURE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;

function objectValue(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function assertClosedKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, name: string): void {
	const unexpected = Object.keys(value).find((key) => !allowed.has(key));
	if (unexpected) throw new TypeError(`${name} contains an unsupported field: ${unexpected}.`);
}

function boundedString(value: unknown, name: string, maximumLength: number): string {
	if (typeof value !== 'string' || !value || value !== value.trim()) {
		throw new TypeError(`${name} must be a non-empty canonical string.`);
	}
	if (value.length > maximumLength) throw new RangeError(`${name} length exceeds its maximum.`);
	if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) {
		throw new TypeError(`${name} must not contain control or formatting characters.`);
	}
	return value;
}

function normalizeRequirementId(value: unknown): string {
	const id = boundedString(
		value,
		'requirement.id',
		PROJECT_FEATURE_REQUIREMENTS_LIMITS.maximumRequirementIdLength,
	);
	if (!REQUIREMENT_ID_PATTERN.test(id)) throw new TypeError('requirement.id must be a canonical identifier.');
	return id;
}

function normalizeFeatureId(value: unknown, name = 'requirement.featureId'): string {
	const featureId = boundedString(value, name, PROJECT_FEATURE_REQUIREMENTS_LIMITS.maximumFeatureIdLength);
	if (!FEATURE_ID_PATTERN.test(featureId)) {
		throw new TypeError(`${name} must be a canonical namespaced feature ID.`);
	}
	return featureId;
}

function normalizeSourceId(value: unknown): string {
	return boundedString(
		value,
		'requirement.fallback.sourceId',
		PROJECT_FEATURE_REQUIREMENTS_LIMITS.maximumSourceIdLength,
	);
}

function sourceKind(source: ProjectSourceReference): ProjectFeatureFallbackKind | null {
	if (source.kind === undefined || source.kind === 'audio') return 'audio';
	if (source.kind === 'video') return 'video';
	return null;
}

function normalizeFallback(
	value: unknown,
	manifestSchemaVersion: 1 | 2,
	featureId: string,
	sourcesById: ReadonlyMap<string, ProjectSourceReference>,
	clips: readonly ProjectTimelineClipReference[],
	tracks: readonly ProjectTrackReference[],
	options: NormalizeProjectFeatureRequirementsOptions,
): ProjectFeatureFallback {
	const candidate = objectValue(value, 'requirement.fallback');
	if (manifestSchemaVersion === 1) {
		assertClosedKeys(candidate, FALLBACK_V1_KEYS, 'requirement.fallback');
	} else if (candidate.role === 'video-clip-render-v1') {
		assertClosedKeys(candidate, CLIP_FALLBACK_V2_KEYS, 'requirement.fallback');
	} else if (candidate.role === 'audio-track-render-v1') {
		assertClosedKeys(candidate, TRACK_FALLBACK_V2_KEYS, 'requirement.fallback');
	} else {
		assertClosedKeys(candidate, FALLBACK_V2_KEYS, 'requirement.fallback');
	}
	if (candidate.kind !== 'audio' && candidate.kind !== 'video') {
		throw new RangeError('requirement.fallback.kind must be audio or video.');
	}
	const role = normalizeFallbackRole(candidate, manifestSchemaVersion);
	const audioRole = role === 'project-audio-mix-v1' || role === 'audio-track-render-v1';
	if (isProjectFeatureCapabilityId(featureId)) {
		if (audioRole && !isProjectFeatureAudioCapabilityId(featureId)) {
			throw new RangeError(`Feature ${featureId} is not eligible for an audio rendered fallback.`);
		}
		if (!audioRole && !isProjectFeatureVideoCapabilityId(featureId)) {
			throw new RangeError(`Feature ${featureId} is not eligible for a video rendered fallback.`);
		}
	}
	if ((audioRole && candidate.kind !== 'audio') || (!audioRole && candidate.kind !== 'video')) {
		throw new RangeError(`requirement.fallback role ${role} does not match its kind.`);
	}
	const sourceId = normalizeSourceId(candidate.sourceId);
	const source = sourcesById.get(sourceId);
	if (!source) throw new ReferenceError(`Fallback source ${sourceId} does not exist in the project.`);
	if (sourceKind(source) !== candidate.kind) {
		throw new RangeError(`Fallback source ${sourceId} kind does not match requirement.fallback.kind.`);
	}
	if (typeof candidate.sha256 !== 'string' || !SHA_256_PATTERN.test(candidate.sha256)) {
		throw new TypeError('requirement.fallback SHA-256 digest must be 64 lowercase hexadecimal characters.');
	}
	if (role === 'audio-track-render-v1') {
		const targetTrackId = boundedString(
			candidate.targetTrackId,
			'requirement.fallback.targetTrackId',
			PROJECT_FEATURE_REQUIREMENTS_LIMITS.maximumSourceIdLength,
		);
		validateAudioTrackFallback(
			featureId, targetTrackId, sourceId, candidate.sha256, source, clips, tracks,
		);
		return Object.freeze({
			role,
			kind: 'audio',
			sourceId,
			sha256: candidate.sha256,
			targetTrackId,
		});
	}
	if (role !== 'video-clip-render-v1') {
		return Object.freeze({ role, kind: candidate.kind, sourceId, sha256: candidate.sha256 }) as ProjectFeatureFallback;
	}
	const targetClipId = boundedString(
		candidate.targetClipId,
		'requirement.fallback.targetClipId',
		PROJECT_FEATURE_REQUIREMENTS_LIMITS.maximumSourceIdLength,
	);
	validateVideoClipFallback(featureId, targetClipId, sourceId, source, sourcesById, clips, options);
	return Object.freeze({
		role,
		kind: 'video',
		sourceId,
		sha256: candidate.sha256,
		targetClipId,
	});
}

function normalizeFallbackRole(
	candidate: Readonly<Record<string, unknown>>,
	manifestSchemaVersion: 1 | 2,
): ProjectFeatureFallbackRole {
	if (manifestSchemaVersion === 1) {
		return candidate.kind === 'audio' ? 'project-audio-mix-v1' : 'project-video-render-v1';
	}
	if (
		candidate.role !== 'project-audio-mix-v1'
		&& candidate.role !== 'audio-track-render-v1'
		&& candidate.role !== 'project-video-render-v1'
		&& candidate.role !== 'video-clip-render-v1'
	) throw new RangeError('requirement.fallback.role is unsupported.');
	return candidate.role;
}

/**
 * A track render replaces exactly one active audio effect rack and its clip
 * lane, so the target must actually carry that surface: an inert rack or an
 * empty lane has nothing a publisher render could stand in for.
 */
function validateAudioTrackFallback(
	featureId: string,
	targetTrackId: string,
	fallbackSourceId: string,
	fallbackSha256: string,
	fallbackSource: ProjectSourceReference,
	clips: readonly ProjectTimelineClipReference[],
	tracks: readonly ProjectTrackReference[],
): void {
	const targets = tracks.filter((track) => track.id === targetTrackId);
	if (targets.length !== 1) {
		throw new ReferenceError(`An audio track rendered fallback requires exactly one target track ${targetTrackId}.`);
	}
	const target = targets[0]!;
	if (target.type !== 'audio') throw new RangeError(`Fallback target ${targetTrackId} must be an audio track.`);
	if (featureId === PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze) {
		validateAudioFreezeTrackFallback(
			target, targetTrackId, fallbackSourceId, fallbackSha256, fallbackSource, clips,
		);
		return;
	}
	if (featureId !== PROJECT_FEATURE_CAPABILITY_IDS.audioEffects) {
		throw new RangeError('An audio track rendered fallback requires the maintained audio-effects feature.');
	}
	if (target.effectsActive === false) {
		throw new RangeError(`Fallback target ${targetTrackId} requires an active effect rack.`);
	}
	const effects = Array.isArray(target.effects) ? target.effects as readonly Readonly<{
		enabled?: unknown;
		bypassed?: unknown;
	}>[] : [];
	if (!effects.some((effect) => effect.enabled !== false && effect.bypassed !== true)) {
		throw new RangeError(`Fallback target ${targetTrackId} requires at least one enabled audio effect.`);
	}
	if (!Array.isArray(target.clipIds) || target.clipIds.length === 0) {
		throw new RangeError(`Fallback target ${targetTrackId} requires at least one timeline clip.`);
	}
	let extentFrames = 0;
	for (const clipId of target.clipIds) {
		const matches = clips.filter((clip) => clip.id === clipId);
		if (matches.length !== 1) {
			throw new ReferenceError(`Fallback target ${targetTrackId} references a missing timeline clip.`);
		}
		const clip = matches[0]!;
		if (clip.kind === 'video') {
			throw new RangeError(`Fallback target ${targetTrackId} must reference only audio clips.`);
		}
		if (clip.sourceId === fallbackSourceId) {
			throw new RangeError('An audio track rendered fallback must differ from its target canonical sources.');
		}
		const start = clip.timelineStartFrame;
		const duration = clip.durationFrames;
		if (!Number.isSafeInteger(start) || Number(start) < 0
			|| !Number.isSafeInteger(duration) || Number(duration) < 1) {
			throw new RangeError(`Fallback target ${targetTrackId} has a clip without exact timeline placement.`);
		}
		extentFrames = Math.max(extentFrames, Number(start) + Number(duration));
	}
	if (fallbackSource.frameCount !== extentFrames) {
		throw new RangeError('An audio track rendered fallback source frameCount must equal the target track extent.');
	}
}

function validateAudioFreezeTrackFallback(
	target: ProjectTrackReference,
	targetTrackId: string,
	fallbackSourceId: string,
	fallbackSha256: string,
	fallbackSource: ProjectSourceReference,
	clips: readonly ProjectTimelineClipReference[],
): void {
	const freeze = normalizeAudioTrackFreezeV1(target.audioFreeze);
	if (freeze.derivedSourceId !== fallbackSourceId) {
		throw new RangeError(`Frozen fallback target ${targetTrackId} must bind its exact derived source.`);
	}
	if (fallbackSource.contentSha256 !== fallbackSha256) {
		throw new RangeError('A frozen track fallback digest must match its derived source content identity.');
	}
	if (fallbackSource.frameCount !== freeze.renderFrameCount) {
		throw new RangeError('A frozen track fallback source frameCount must equal its exact render range.');
	}
	if (!Array.isArray(target.clipIds) || target.clipIds.length === 0) {
		throw new RangeError(`Frozen fallback target ${targetTrackId} requires retained editable clips.`);
	}
	for (const clipId of target.clipIds) {
		const matches = clips.filter((clip) => clip.id === clipId);
		if (matches.length !== 1) {
			throw new ReferenceError(`Frozen fallback target ${targetTrackId} references a missing timeline clip.`);
		}
		if (matches[0]!.sourceId === fallbackSourceId) {
			throw new RangeError('A frozen track fallback source cannot replace retained editable authority in the document.');
		}
	}
}

function validateVideoClipFallback(
	featureId: string,
	targetClipId: string,
	fallbackSourceId: string,
	fallbackSource: ProjectSourceReference,
	sourcesById: ReadonlyMap<string, ProjectSourceReference>,
	clips: readonly ProjectTimelineClipReference[],
	options: NormalizeProjectFeatureRequirementsOptions,
): void {
	if (featureId !== PROJECT_FEATURE_CAPABILITY_IDS.videoEffects) {
		throw new RangeError('A video clip rendered fallback requires the maintained video-effects feature.');
	}
	const targets = clips.filter((clip) => clip.id === targetClipId);
	if (targets.length !== 1) {
		throw new ReferenceError(`A video clip rendered fallback requires exactly one timeline target clip ${targetClipId}.`);
	}
	const target = targets[0]!;
	if (target.kind !== 'video') throw new RangeError(`Fallback target ${targetClipId} must be a video clip.`);
	const effects = normalizeVideoEffects(target.videoEffects, `clip ${targetClipId}.videoEffects`);
	if (!effects.some((effect: { readonly enabled: boolean }) => effect.enabled)) {
		throw new RangeError(`Fallback target ${targetClipId} requires at least one enabled maintained video effect.`);
	}
	if (target.sourceId === fallbackSourceId) {
		throw new RangeError('A clip rendered fallback must differ from the target clip canonical source.');
	}
	if (typeof target.sourceId !== 'string') {
		throw new TypeError(`Fallback target ${targetClipId} must reference a canonical source ID.`);
	}
	const targetSource = sourcesById.get(target.sourceId);
	if (!targetSource || targetSource.kind !== 'video') {
		throw new ReferenceError(`Fallback target ${targetClipId} references a missing canonical video source.`);
	}
	if (fallbackSource.hasAudio !== false) {
		throw new RangeError('A video clip rendered fallback source must have hasAudio false.');
	}
	const fallbackFrameCount = fallbackSource.sampleFrameCount ?? fallbackSource.frameCount;
	if (fallbackFrameCount !== resolveVideoClipDurationFrames(target, options)) {
		throw new RangeError('A video clip rendered fallback source sample-frame count must equal the resolved target duration.');
	}
	for (const field of ['sampleRate', 'width', 'height'] as const) {
		if (fallbackSource[field] !== targetSource[field]) {
			throw new RangeError(`A video clip rendered fallback source ${field} must match its canonical source.`);
		}
	}
	if (!sameRationalRate(fallbackSource.frameRate, targetSource.frameRate)) {
		throw new RangeError('A video clip rendered fallback source frameRate must match its canonical source.');
	}
}

function resolveVideoClipDurationFrames(
	target: ProjectTimelineClipReference,
	options: NormalizeProjectFeatureRequirementsOptions,
): number {
	if (Number.isSafeInteger(target.durationFrames) && Number(target.durationFrames) > 0) {
		return Number(target.durationFrames);
	}
	if (!Number.isSafeInteger(target.sequenceFrameCount) || Number(target.sequenceFrameCount) < 1) {
		throw new RangeError('A video clip rendered fallback target has no resolvable duration.');
	}
	if (!Number.isSafeInteger(options.schemaVersion) || !Number.isSafeInteger(options.sampleRate)
		|| typeof options.primarySequenceId !== 'string') {
		throw new RangeError('A video clip rendered fallback target has no foundation timeline context.');
	}
	return resolveRuntimeClipProjection({
		schemaVersion: Number(options.schemaVersion),
		sampleRate: Number(options.sampleRate),
		sequences: options.sequences,
		primarySequenceId: options.primarySequenceId,
	}, target as Readonly<Record<string, unknown>>).durationFrames;
}

function sameRationalRate(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (!left || typeof left !== 'object' || Array.isArray(left)
		|| !right || typeof right !== 'object' || Array.isArray(right)) return false;
	const leftRate = left as Readonly<Record<string, unknown>>;
	const rightRate = right as Readonly<Record<string, unknown>>;
	return leftRate.num === rightRate.num && leftRate.den === rightRate.den;
}

function sourceMap(sources: readonly ProjectSourceReference[]): ReadonlyMap<string, ProjectSourceReference> {
	if (!Array.isArray(sources)) throw new TypeError('Project sources must be an array.');
	const output = new Map<string, ProjectSourceReference>();
	for (const source of sources) {
		const candidate = objectValue(source, 'project source') as ProjectSourceReference;
		if (typeof candidate.id !== 'string' || !candidate.id) {
			throw new TypeError('Project source ID must be a non-empty string.');
		}
		if (output.has(candidate.id)) throw new RangeError(`Duplicate project source ID: ${candidate.id}.`);
		output.set(candidate.id, candidate);
	}
	return output;
}

export function normalizeProjectFeatureRequirements(
	value: unknown,
	options: NormalizeProjectFeatureRequirementsOptions,
): ProjectFeatureRequirementsManifest {
	const candidate = objectValue(value, 'project.featureRequirements');
	assertClosedKeys(candidate, MANIFEST_KEYS, 'project.featureRequirements');
	if (candidate.schemaVersion !== 1 && candidate.schemaVersion !== PROJECT_FEATURE_REQUIREMENTS_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported project feature-requirements schema version: ${String(candidate.schemaVersion)}.`);
	}
	const manifestSchemaVersion = candidate.schemaVersion;
	if (!Array.isArray(candidate.requirements)) {
		throw new TypeError('project.featureRequirements.requirements must be an array.');
	}
	if (candidate.requirements.length > PROJECT_FEATURE_REQUIREMENTS_LIMITS.maximumRequirements) {
		throw new RangeError('Too many project feature requirements; the maximum requirements limit was exceeded.');
	}
	const sourcesById = sourceMap(options.sources);
	const clips = timelineClips(options.clips ?? []);
	const tracks = timelineTracks(options.tracks ?? []);
	const ids = new Set<string>();
	const requirements = Array.from(candidate.requirements, (value, index) => {
		const requirement = objectValue(value, `project.featureRequirements.requirements[${String(index)}]`);
		assertClosedKeys(requirement, REQUIREMENT_KEYS, 'project feature requirement');
		const id = normalizeRequirementId(requirement.id);
		if (ids.has(id)) throw new RangeError(`Duplicate project feature requirement ID: ${id}.`);
		ids.add(id);
		const featureId = normalizeFeatureId(requirement.featureId);
		const displayName = boundedString(
			requirement.displayName,
			'requirement.displayName',
			PROJECT_FEATURE_REQUIREMENTS_LIMITS.maximumDisplayNameLength,
		);
		if (requirement.disposition !== 'bypass' && requirement.disposition !== 'rendered-fallback') {
			throw new RangeError('requirement.disposition must be bypass or rendered-fallback.');
		}
		if (requirement.disposition === 'bypass' && requirement.fallback !== null) {
			throw new TypeError('A bypass disposition requires a null fallback.');
		}
		if (requirement.disposition === 'rendered-fallback' && requirement.fallback == null) {
			throw new TypeError('A rendered-fallback disposition requires a fallback descriptor.');
		}
		const fallback = requirement.disposition === 'rendered-fallback'
			? normalizeFallback(requirement.fallback, manifestSchemaVersion, featureId, sourcesById, clips, tracks, options)
			: null;
		return Object.freeze({ id, featureId, displayName, disposition: requirement.disposition, fallback });
	});
	return Object.freeze({
		schemaVersion: PROJECT_FEATURE_REQUIREMENTS_SCHEMA_VERSION,
		requirements: Object.freeze(requirements),
	});
}

function timelineClips(value: readonly ProjectTimelineClipReference[]): readonly ProjectTimelineClipReference[] {
	if (!Array.isArray(value)) throw new TypeError('Project timeline clips must be an array.');
	return value.map((clip) => objectValue(clip, 'project timeline clip') as ProjectTimelineClipReference);
}

function timelineTracks(value: readonly ProjectTrackReference[]): readonly ProjectTrackReference[] {
	if (!Array.isArray(value)) throw new TypeError('Project tracks must be an array.');
	return value.map((track) => objectValue(track, 'project track') as ProjectTrackReference);
}

export function remapProjectFeatureRequirementSourceIds(
	manifest: ProjectFeatureRequirementsManifest,
	sourceIdMap: ReadonlyMap<string, string>,
	options: NormalizeProjectFeatureRequirementsOptions,
): ProjectFeatureRequirementsManifest {
	const remapped = {
		schemaVersion: manifest.schemaVersion,
		requirements: manifest.requirements.map((requirement) => ({
			...requirement,
			fallback: requirement.fallback == null
				? null
				: {
					...requirement.fallback,
					sourceId: sourceIdMap.get(requirement.fallback.sourceId) ?? requirement.fallback.sourceId,
				},
		})),
	};
	return normalizeProjectFeatureRequirements(remapped, options);
}

function featureIdSet(value: ReadonlySet<string>, name: string): Set<string> {
	if (!value || typeof value.has !== 'function' || typeof value[Symbol.iterator] !== 'function') {
		throw new TypeError(`${name} must be a set of feature IDs.`);
	}
	const output = new Set<string>();
	for (const candidate of value) output.add(normalizeFeatureId(candidate, name));
	return output;
}

function evaluationSources(value: unknown): readonly ProjectSourceReference[] {
	const candidate = objectValue(value, 'project.featureRequirements');
	assertClosedKeys(candidate, MANIFEST_KEYS, 'project.featureRequirements');
	if (candidate.schemaVersion !== 1 && candidate.schemaVersion !== PROJECT_FEATURE_REQUIREMENTS_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported project feature-requirements schema version: ${String(candidate.schemaVersion)}.`);
	}
	if (!Array.isArray(candidate.requirements)) {
		throw new TypeError('project.featureRequirements.requirements must be an array.');
	}
	if (candidate.requirements.length > PROJECT_FEATURE_REQUIREMENTS_LIMITS.maximumRequirements) {
		throw new RangeError('Too many project feature requirements; the maximum requirements limit was exceeded.');
	}
	const sources = new Map<string, ProjectSourceReference>();
	Array.from(candidate.requirements, (value, index) => {
		const requirement = objectValue(value, `project.featureRequirements.requirements[${String(index)}]`);
		if (requirement.fallback == null) return;
		const fallback = objectValue(requirement.fallback, 'requirement.fallback');
		if (typeof fallback.sourceId !== 'string' || sources.has(fallback.sourceId)) return;
		sources.set(fallback.sourceId, { id: fallback.sourceId, kind: fallback.kind });
	});
	return [...sources.values()];
}

export function evaluateProjectFeatureRequirements(
	manifest: ProjectFeatureRequirementsManifest,
	options: EvaluateProjectFeatureRequirementsOptions,
): ProjectFeatureRequirementsReport {
	const normalizedManifest = normalizeProjectFeatureRequirements(manifest, {
		sources: options.sources ?? evaluationSources(manifest),
		clips: options.clips ?? [],
		tracks: options.tracks ?? [],
		schemaVersion: options.schemaVersion,
		sampleRate: options.sampleRate,
		sequences: options.sequences,
		primarySequenceId: options.primarySequenceId,
	});
	const knownFeatureIds = featureIdSet(options.knownFeatureIds, 'knownFeatureIds');
	const availableFeatureIds = featureIdSet(options.availableFeatureIds, 'availableFeatureIds');
	for (const featureId of availableFeatureIds) {
		if (!knownFeatureIds.has(featureId)) {
			throw new RangeError(`Available feature ID is not declared known: ${featureId}.`);
		}
	}
	const counts = { available: 0, unavailable: 0, unknown: 0 };
	const items = normalizedManifest.requirements.map((requirement): ProjectFeatureRequirementsReportItem => {
		const availability: ProjectFeatureAvailability = !knownFeatureIds.has(requirement.featureId)
			? 'unknown'
			: availableFeatureIds.has(requirement.featureId) ? 'available' : 'unavailable';
		counts[availability] += 1;
		const disposition: ProjectFeatureEffectiveDisposition = availability === 'available'
			? 'native'
			: requirement.disposition === 'bypass' ? 'bypassed' : 'rendered-fallback';
		const message = availability === 'available'
			? `${requirement.displayName} is available natively.`
			: availability === 'unavailable'
				? `${requirement.displayName} is known but unavailable and will be ${disposition}.`
				: `${requirement.displayName} is unknown and will be ${disposition}.`;
		return Object.freeze({
			requirementId: requirement.id,
			featureId: requirement.featureId,
			displayName: requirement.displayName,
			availability,
			declaredDisposition: requirement.disposition,
			disposition,
			fallback: requirement.fallback,
			message,
		});
	});
	return Object.freeze({
		schemaVersion: 1,
		format: 'soundscaper-project',
		compatible: counts.unavailable === 0 && counts.unknown === 0,
		counts: Object.freeze(counts),
		items: Object.freeze(items),
	});
}
