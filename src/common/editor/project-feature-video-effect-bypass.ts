/* SPDX-License-Identifier: AGPL-3.0-only */

import { PROJECT_FEATURE_CAPABILITY_IDS } from './project-feature-capabilities.ts';
import { isMaintainedProjectFeatureSchema } from './project-schema-version.ts';
import type { ProjectFeatureRequirementsReport } from './project-feature-requirements.ts';
import { qualifyingProjectFeatureEffectBypassRequirementIds } from './project-feature-effect-bypass-report.ts';
import {
	isRecord,
	optionalDataProperty as dataProperty,
	recordValue,
	replaceDataProperties,
	type RecordValue,
} from './project-feature-projection-record.ts';
import {
	projectFeatureBoundedString,
	projectFeatureLowerOnlyLimit,
} from './project-feature-projection-limits.ts';
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
	if (!isMaintainedProjectFeatureSchema(projectRecord)) return unchanged(project);
	const requirementIds = qualifyingProjectFeatureEffectBypassRequirementIds(
		report,
		PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
	);
	if (requirementIds.length === 0) return unchanged(project);
	const maximumAffectedEffects = projectFeatureLowerOnlyLimit(
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
		projectFeatureBoundedString(
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
	return projectFeatureBoundedString(
		value,
		name,
		PROJECT_FEATURE_VIDEO_EFFECT_BYPASS_LIMITS.maximumStableIdLength,
	);
}
