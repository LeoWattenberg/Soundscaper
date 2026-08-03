/* SPDX-License-Identifier: AGPL-3.0-only */

import { PROJECT_FEATURE_CAPABILITY_IDS } from './project-feature-capabilities.ts';
import { normalizeVideoEffects } from './video-effects.js';

export const PROJECT_FEATURE_REQUIREMENTS_SCHEMA_VERSION = 2;
export const PROJECT_FEATURE_REQUIREMENTS_LIMITS = Object.freeze({
	maximumRequirements: 1_024,
	maximumRequirementIdLength: 128,
	maximumFeatureIdLength: 256,
	maximumDisplayNameLength: 256,
	maximumSourceIdLength: 256,
});

export type ProjectFeatureRequirementDisposition = 'bypass' | 'rendered-fallback';
export type ProjectFeatureFallbackKind = 'audio' | 'video';
export type ProjectFeatureFallbackRole =
	| 'project-audio-mix-v1'
	| 'project-video-render-v1'
	| 'video-clip-render-v1';

export interface ProjectFeatureAudioMixFallback {
	readonly role: 'project-audio-mix-v1';
	readonly kind: 'audio';
	readonly sourceId: string;
	readonly sha256: string;
}

export interface ProjectFeatureVideoRenderFallback {
	readonly role: 'project-video-render-v1';
	readonly kind: 'video';
	readonly sourceId: string;
	readonly sha256: string;
}

export interface ProjectFeatureVideoClipRenderFallback {
	readonly role: 'video-clip-render-v1';
	readonly kind: 'video';
	readonly sourceId: string;
	readonly sha256: string;
	readonly targetClipId: string;
}

export type ProjectFeatureFallback =
	| ProjectFeatureAudioMixFallback
	| ProjectFeatureVideoRenderFallback
	| ProjectFeatureVideoClipRenderFallback;

export interface ProjectFeatureRequirement {
	readonly id: string;
	readonly featureId: string;
	readonly displayName: string;
	readonly disposition: ProjectFeatureRequirementDisposition;
	readonly fallback: ProjectFeatureFallback | null;
}

export interface ProjectFeatureRequirementsManifest {
	readonly schemaVersion: 2;
	readonly requirements: readonly ProjectFeatureRequirement[];
}

export type ProjectFeatureAvailability = 'available' | 'unavailable' | 'unknown';
export type ProjectFeatureEffectiveDisposition = 'native' | 'bypassed' | 'rendered-fallback';

export interface ProjectFeatureRequirementsReportItem {
	readonly requirementId: string;
	readonly featureId: string;
	readonly displayName: string;
	readonly availability: ProjectFeatureAvailability;
	readonly declaredDisposition: ProjectFeatureRequirementDisposition;
	readonly disposition: ProjectFeatureEffectiveDisposition;
	readonly fallback: ProjectFeatureFallback | null;
	readonly message: string;
}

export interface ProjectFeatureRequirementsReport {
	readonly schemaVersion: 1;
	readonly format: 'soundscaper-project';
	readonly compatible: boolean;
	readonly counts: Readonly<Record<ProjectFeatureAvailability, number>>;
	readonly items: readonly ProjectFeatureRequirementsReportItem[];
}

interface ProjectSourceReference {
	readonly id?: unknown;
	readonly kind?: unknown;
	readonly frameCount?: unknown;
	readonly sampleRate?: unknown;
	readonly width?: unknown;
	readonly height?: unknown;
	readonly frameRate?: unknown;
	readonly hasAudio?: unknown;
}

interface ProjectTimelineClipReference {
	readonly id?: unknown;
	readonly kind?: unknown;
	readonly sourceId?: unknown;
	readonly durationFrames?: unknown;
	readonly videoEffects?: unknown;
}

interface NormalizeProjectFeatureRequirementsOptions {
	readonly sources: readonly ProjectSourceReference[];
	readonly clips?: readonly ProjectTimelineClipReference[];
}

interface EvaluateProjectFeatureRequirementsOptions {
	readonly knownFeatureIds: ReadonlySet<string>;
	readonly availableFeatureIds: ReadonlySet<string>;
	readonly sources?: readonly ProjectSourceReference[];
	readonly clips?: readonly ProjectTimelineClipReference[];
}

const MANIFEST_KEYS = new Set(['schemaVersion', 'requirements']);
const REQUIREMENT_KEYS = new Set(['id', 'featureId', 'displayName', 'disposition', 'fallback']);
const FALLBACK_V1_KEYS = new Set(['kind', 'sourceId', 'sha256']);
const FALLBACK_V2_KEYS = new Set(['role', 'kind', 'sourceId', 'sha256']);
const CLIP_FALLBACK_V2_KEYS = new Set([...FALLBACK_V2_KEYS, 'targetClipId']);
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
): ProjectFeatureFallback {
	const candidate = objectValue(value, 'requirement.fallback');
	if (manifestSchemaVersion === 1) {
		assertClosedKeys(candidate, FALLBACK_V1_KEYS, 'requirement.fallback');
	} else if (candidate.role === 'video-clip-render-v1') {
		assertClosedKeys(candidate, CLIP_FALLBACK_V2_KEYS, 'requirement.fallback');
	} else {
		assertClosedKeys(candidate, FALLBACK_V2_KEYS, 'requirement.fallback');
	}
	if (candidate.kind !== 'audio' && candidate.kind !== 'video') {
		throw new RangeError('requirement.fallback.kind must be audio or video.');
	}
	const role = normalizeFallbackRole(candidate, manifestSchemaVersion);
	if (
		(role === 'project-audio-mix-v1' && candidate.kind !== 'audio')
		|| (role !== 'project-audio-mix-v1' && candidate.kind !== 'video')
	) throw new RangeError(`requirement.fallback role ${role} does not match its kind.`);
	const sourceId = normalizeSourceId(candidate.sourceId);
	const source = sourcesById.get(sourceId);
	if (!source) throw new ReferenceError(`Fallback source ${sourceId} does not exist in the project.`);
	if (sourceKind(source) !== candidate.kind) {
		throw new RangeError(`Fallback source ${sourceId} kind does not match requirement.fallback.kind.`);
	}
	if (typeof candidate.sha256 !== 'string' || !SHA_256_PATTERN.test(candidate.sha256)) {
		throw new TypeError('requirement.fallback SHA-256 digest must be 64 lowercase hexadecimal characters.');
	}
	if (role !== 'video-clip-render-v1') {
		return Object.freeze({ role, kind: candidate.kind, sourceId, sha256: candidate.sha256 }) as ProjectFeatureFallback;
	}
	const targetClipId = boundedString(
		candidate.targetClipId,
		'requirement.fallback.targetClipId',
		PROJECT_FEATURE_REQUIREMENTS_LIMITS.maximumSourceIdLength,
	);
	validateVideoClipFallback(featureId, targetClipId, sourceId, source, sourcesById, clips);
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
		&& candidate.role !== 'project-video-render-v1'
		&& candidate.role !== 'video-clip-render-v1'
	) throw new RangeError('requirement.fallback.role is unsupported.');
	return candidate.role;
}

function validateVideoClipFallback(
	featureId: string,
	targetClipId: string,
	fallbackSourceId: string,
	fallbackSource: ProjectSourceReference,
	sourcesById: ReadonlyMap<string, ProjectSourceReference>,
	clips: readonly ProjectTimelineClipReference[],
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
	if (fallbackSource.frameCount !== target.durationFrames) {
		throw new RangeError('A video clip rendered fallback source frameCount must equal the target durationFrames.');
	}
	for (const field of ['sampleRate', 'width', 'height', 'frameRate'] as const) {
		if (fallbackSource[field] !== targetSource[field]) {
			throw new RangeError(`A video clip rendered fallback source ${field} must match its canonical source.`);
		}
	}
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
			? normalizeFallback(requirement.fallback, manifestSchemaVersion, featureId, sourcesById, clips)
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
