/* SPDX-License-Identifier: AGPL-3.0-only */

import { PROJECT_FEATURE_CAPABILITY_IDS } from './project-feature-capabilities.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from './project-schema-version.ts';
import type { ProjectFeatureRequirementsReport } from './project-feature-requirements.ts';
import { VIDEO_EFFECT_TYPES } from './video-effects.js';

export const PROJECT_FEATURE_VIDEO_EFFECT_BYPASS_LIMITS = Object.freeze({
	maximumAffectedEffects: 4_096,
	maximumStableIdLength: 256,
	maximumEffectTypeLength: 128,
});

export interface ProjectFeatureVideoEffectPlaceholder {
	readonly location: 'timeline' | 'project-bin';
	readonly clipId: string;
	readonly effectId: string;
	readonly effectType: string;
}

export interface ProjectFeatureVideoEffectBypassMetadata {
	readonly schemaVersion: 1;
	readonly featureId: typeof PROJECT_FEATURE_CAPABILITY_IDS.videoEffects;
	readonly requirementIds: readonly string[];
	readonly placeholders: readonly ProjectFeatureVideoEffectPlaceholder[];
}

export interface ProjectFeatureVideoEffectBypassProjection<Project> {
	readonly project: Project;
	readonly metadata: ProjectFeatureVideoEffectBypassMetadata | null;
}

export interface ProjectFeatureVideoEffectBypassOptions {
	/** Test seam: production limits may only be lowered. */
	readonly maximumAffectedEffects?: number;
}

type RecordValue = Readonly<Record<string, unknown>>;

interface ClipProjection {
	readonly clip: unknown;
	readonly changed: boolean;
}

const VIDEO_EFFECT_TYPE_SET: ReadonlySet<string> = new Set(VIDEO_EFFECT_TYPES as readonly string[]);
const EMPTY_RESULT = Object.freeze({ metadata: null });

/**
 * Derive a non-persisted preview-playback view for one exact-schema project.
 * Only enabled maintained effects on video clips are disabled. Canonical
 * project history and effect payloads remain untouched.
 */
export function projectFeatureVideoEffectPlaybackBypass<Project extends object>(
	project: Project,
	report: ProjectFeatureRequirementsReport | null | undefined,
	options: ProjectFeatureVideoEffectBypassOptions = {},
): ProjectFeatureVideoEffectBypassProjection<Project> {
	const projectRecord = recordValue(project, 'project');
	if (dataProperty(projectRecord, 'schemaVersion', 'project') !== AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) return unchanged(project);
	const requirementIds = qualifyingRequirementIds(report);
	if (requirementIds.length === 0) return unchanged(project);
	const maximumAffectedEffects = lowerOnlyLimit(
		options.maximumAffectedEffects,
		PROJECT_FEATURE_VIDEO_EFFECT_BYPASS_LIMITS.maximumAffectedEffects,
		'maximumAffectedEffects',
	);
	const placeholders: ProjectFeatureVideoEffectPlaceholder[] = [];

	let clipsChanged = false;
	const clipsValue = dataProperty(projectRecord, 'clips', 'project');
	const clips = Array.isArray(clipsValue) ? clipsValue.map((clip, index) => {
		if (!isRecord(clip)) return clip;
		const clipName = `project.clips[${String(index)}]`;
		if (dataProperty(clip, 'kind', clipName) !== 'video') return clip;
		const projected = projectClip(
			clip,
			'timeline',
			clipName,
			placeholders,
			maximumAffectedEffects,
		);
		clipsChanged ||= projected.changed;
		return projected.clip;
	}) : [];

	const projectBinValue = dataProperty(projectRecord, 'projectBin', 'project');
	const projectBin = isRecord(projectBinValue) ? projectBinValue : null;
	let projectedProjectBin: unknown = projectBinValue;
	let projectBinChanged = false;
	if (projectBin) {
		const binClipsValue = dataProperty(projectBin, 'clips', 'project.projectBin');
		if (Array.isArray(binClipsValue)) {
			const binClips = binClipsValue.map((clip, index) => {
				if (!isRecord(clip)) return clip;
				const clipName = `project.projectBin.clips[${String(index)}]`;
				if (dataProperty(clip, 'kind', clipName) !== 'video') return clip;
				const projected = projectClip(
					clip,
					'project-bin',
					clipName,
					placeholders,
					maximumAffectedEffects,
				);
				projectBinChanged ||= projected.changed;
				return projected.clip;
			});
			if (projectBinChanged) {
				projectedProjectBin = replaceDataProperties(projectBin, { clips: Object.freeze(binClips) });
			}
		}
	}
	if (!clipsChanged && !projectBinChanged) return unchanged(project);

	const replacements: Record<string, unknown> = {};
	if (clipsChanged) replacements.clips = Object.freeze(clips);
	if (projectBinChanged) replacements.projectBin = projectedProjectBin;
	const projectedProject = replaceDataProperties(projectRecord, replacements) as unknown as Project;
	const metadata = Object.freeze({
		schemaVersion: 1 as const,
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
		requirementIds: Object.freeze(requirementIds),
		placeholders: Object.freeze(placeholders),
	});
	return Object.freeze({ project: projectedProject, metadata });
}

function unchanged<Project>(project: Project): ProjectFeatureVideoEffectBypassProjection<Project> {
	return Object.freeze({ project, ...EMPTY_RESULT });
}

function qualifyingRequirementIds(
	report: ProjectFeatureRequirementsReport | null | undefined,
): string[] {
	if (report?.compatible !== false || report.format !== 'soundscaper-project' || !Array.isArray(report.items)) {
		return [];
	}
	const output: string[] = [];
	for (const item of report.items) {
		if (
			item.featureId !== PROJECT_FEATURE_CAPABILITY_IDS.videoEffects
			|| item.availability !== 'unavailable'
			|| item.declaredDisposition !== 'bypass'
			|| item.disposition !== 'bypassed'
		) continue;
		output.push(stableId(item.requirementId, 'feature requirement ID'));
	}
	return output;
}

function projectClip(
	clip: RecordValue,
	location: ProjectFeatureVideoEffectPlaceholder['location'],
	clipName: string,
	placeholders: ProjectFeatureVideoEffectPlaceholder[],
	maximumAffectedEffects: number,
): ClipProjection {
	const effectsValue = dataProperty(clip, 'videoEffects', clipName);
	if (!Array.isArray(effectsValue)) return { clip, changed: false };
	let changed = false;
	let clipId: string | null = null;
	const effects = effectsValue.map((value, index) => {
		if (!isRecord(value)) return value;
		const effectName = `${clipName} effect ${String(index)}`;
		const effectType = dataProperty(value, 'type', effectName);
		if (typeof effectType !== 'string' || !VIDEO_EFFECT_TYPE_SET.has(effectType)) return value;
		if (dataProperty(value, 'enabled', effectName) === false) return value;
		if (placeholders.length >= maximumAffectedEffects) {
			throw new RangeError('Too many affected video effects; the playback-bypass limit was exceeded.');
		}
		clipId ??= stableId(dataProperty(clip, 'id', clipName), `${clipName}.id`);
		const effectId = stableId(dataProperty(value, 'id', effectName), `${effectName}.id`);
		boundedString(
			effectType,
			`${effectName}.type`,
			PROJECT_FEATURE_VIDEO_EFFECT_BYPASS_LIMITS.maximumEffectTypeLength,
		);
		placeholders.push(Object.freeze({
			location,
			clipId,
			effectId,
			effectType,
		}));
		changed = true;
		return Object.freeze({ id: effectId, type: effectType, enabled: false, params: Object.freeze({}) });
	});
	return changed
		? { clip: replaceDataProperties(clip, { videoEffects: Object.freeze(effects) }), changed: true }
		: { clip, changed: false };
}

function stableId(value: unknown, name: string): string {
	return boundedString(value, name, PROJECT_FEATURE_VIDEO_EFFECT_BYPASS_LIMITS.maximumStableIdLength);
}

function boundedString(value: unknown, name: string, maximumLength: number): string {
	if (typeof value !== 'string' || !value || value.length > maximumLength) {
		throw new TypeError(`${name} must be a non-empty bounded string.`);
	}
	return value;
}

function lowerOnlyLimit(value: unknown, production: number, name: string): number {
	if (value === undefined) return production;
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	if (Number(value) > production) throw new RangeError(`${name} cannot raise the production limit.`);
	return Number(value);
}

function isRecord(value: unknown): value is RecordValue {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function recordValue(value: unknown, name: string): RecordValue {
	if (!isRecord(value)) throw new TypeError(`${name} must be an object.`);
	return value;
}

function dataProperty(value: RecordValue, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) return undefined;
	if (!Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name}.${key} must be a data property.`);
	return descriptor.value;
}

function replaceDataProperties(value: RecordValue, replacements: Record<string, unknown>): RecordValue {
	const descriptors = Object.getOwnPropertyDescriptors(value);
	for (const [key, replacement] of Object.entries(replacements)) {
		descriptors[key] = { configurable: true, enumerable: true, writable: true, value: replacement };
	}
	return Object.freeze(Object.create(Object.getPrototypeOf(value) as object | null, descriptors) as RecordValue);
}
