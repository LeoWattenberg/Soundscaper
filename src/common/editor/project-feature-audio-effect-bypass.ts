/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PROJECT_FEATURE_AUDIO_EFFECT_TYPES,
	PROJECT_FEATURE_CAPABILITY_IDS,
} from './project-feature-capabilities.ts';
import type { ProjectFeatureRequirementsReport } from './project-feature-requirements.ts';

export const PROJECT_FEATURE_AUDIO_EFFECT_BYPASS_LIMITS = Object.freeze({
	maximumAffectedEffects: 4_096,
	maximumStableIdLength: 256,
	maximumEffectTypeLength: 128,
});

export type ProjectFeatureAudioEffectScope = 'track' | 'group' | 'send' | 'master';

export interface ProjectFeatureAudioEffectPlaceholder {
	readonly scope: ProjectFeatureAudioEffectScope;
	readonly ownerId: string | null;
	readonly effectId: string;
	readonly effectType: string;
}

export interface ProjectFeatureAudioEffectBypassMetadata {
	readonly schemaVersion: 1;
	readonly featureId: typeof PROJECT_FEATURE_CAPABILITY_IDS.audioEffects;
	readonly requirementIds: readonly string[];
	readonly placeholders: readonly ProjectFeatureAudioEffectPlaceholder[];
}

export interface ProjectFeatureAudioEffectBypassProjection<Project> {
	readonly project: Project;
	readonly metadata: ProjectFeatureAudioEffectBypassMetadata | null;
}

export interface ProjectFeatureAudioEffectBypassOptions {
	/** Test seam: production limits may only be lowered. */
	readonly maximumAffectedEffects?: number;
}

type RecordValue = Readonly<Record<string, unknown>>;

interface RackProjection {
	readonly owner: unknown;
	readonly changed: boolean;
}

const AUDIO_EFFECT_TYPE_SET: ReadonlySet<string> = new Set(PROJECT_FEATURE_AUDIO_EFFECT_TYPES);

const EMPTY_RESULT = Object.freeze({ metadata: null });

/**
 * Derive a non-persisted interactive-playback view for one exact-schema project.
 * Only a registered, unavailable audio-effects requirement explicitly declaring
 * bypass can activate this path. Canonical project and effect payload state are
 * never mutated or copied into placeholder metadata.
 */
export function projectFeatureAudioEffectPlaybackBypass<
	Project extends object,
>(
	project: Project,
	report: ProjectFeatureRequirementsReport | null | undefined,
	options: ProjectFeatureAudioEffectBypassOptions = {},
): ProjectFeatureAudioEffectBypassProjection<Project> {
	const projectRecord = recordValue(project, 'project');
	if (dataProperty(projectRecord, 'schemaVersion', 'project') !== 9) return unchanged(project);
	const requirementIds = qualifyingRequirementIds(report);
	if (requirementIds.length === 0) return unchanged(project);
	const maximumAffectedEffects = lowerOnlyLimit(
		options.maximumAffectedEffects,
		PROJECT_FEATURE_AUDIO_EFFECT_BYPASS_LIMITS.maximumAffectedEffects,
		'maximumAffectedEffects',
	);
	const placeholders: ProjectFeatureAudioEffectPlaceholder[] = [];

	let tracksChanged = false;
	const tracksValue = dataProperty(projectRecord, 'tracks', 'project');
	const tracks = Array.isArray(tracksValue) ? tracksValue.map((owner, index) => {
		if (!isRecord(owner)) return owner;
		const type = dataProperty(owner, 'type', `project.tracks[${String(index)}]`);
		if (type === 'label' || type === 'video') return owner;
		const ownerId = stableId(
			dataProperty(owner, 'id', `project.tracks[${String(index)}]`),
			`project.tracks[${String(index)}].id`,
		);
		const projected = projectRack(owner, 'track', ownerId, placeholders, maximumAffectedEffects);
		tracksChanged ||= projected.changed;
		return projected.owner;
	}) : [];

	const mixerValue = dataProperty(projectRecord, 'mixer', 'project');
	const mixer = isRecord(mixerValue) ? mixerValue : null;
	let projectedMixer: unknown = mixerValue;
	let mixerChanged = false;
	if (mixer) {
		const replacements: Record<string, unknown> = {};
		for (const [key, scope] of [['groups', 'group'], ['sends', 'send']] as const) {
			const ownersValue = dataProperty(mixer, key, 'project.mixer');
			if (!Array.isArray(ownersValue)) continue;
			let ownersChanged = false;
			const owners = ownersValue.map((owner, index) => {
				if (!isRecord(owner)) return owner;
				const ownerId = stableId(
					dataProperty(owner, 'id', `project.mixer.${key}[${String(index)}]`),
					`project.mixer.${key}[${String(index)}].id`,
				);
				const projected = projectRack(owner, scope, ownerId, placeholders, maximumAffectedEffects);
				ownersChanged ||= projected.changed;
				return projected.owner;
			});
			if (ownersChanged) {
				replacements[key] = Object.freeze(owners);
				mixerChanged = true;
			}
		}
		if (mixerChanged) projectedMixer = replaceDataProperties(mixer, replacements);
	}

	const masterValue = dataProperty(projectRecord, 'master', 'project');
	const master = isRecord(masterValue)
		? projectRack(masterValue, 'master', null, placeholders, maximumAffectedEffects)
		: { owner: masterValue, changed: false };
	if (placeholders.length === 0) return unchanged(project);

	const replacements: Record<string, unknown> = {};
	if (tracksChanged) replacements.tracks = Object.freeze(tracks);
	if (mixerChanged) replacements.mixer = projectedMixer;
	if (master.changed) replacements.master = master.owner;
	const projectedProject = replaceDataProperties(projectRecord, replacements) as unknown as Project;
	const metadata = Object.freeze({
		schemaVersion: 1 as const,
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
		requirementIds: Object.freeze(requirementIds),
		placeholders: Object.freeze(placeholders),
	});
	return Object.freeze({ project: projectedProject, metadata });
}

function unchanged<Project>(project: Project): ProjectFeatureAudioEffectBypassProjection<Project> {
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
			item.featureId !== PROJECT_FEATURE_CAPABILITY_IDS.audioEffects
			|| item.availability !== 'unavailable'
			|| item.declaredDisposition !== 'bypass'
			|| item.disposition !== 'bypassed'
		) continue;
		output.push(stableId(item.requirementId, 'feature requirement ID'));
	}
	return output;
}

function projectRack(
	owner: RecordValue,
	scope: ProjectFeatureAudioEffectScope,
	ownerId: string | null,
	placeholders: ProjectFeatureAudioEffectPlaceholder[],
	maximumAffectedEffects: number,
): RackProjection {
	if (dataProperty(owner, 'effectsActive', `${scope} effect rack`) === false) {
		return { owner, changed: false };
	}
	const effectsValue = dataProperty(owner, 'effects', `${scope} effect rack`);
	if (!Array.isArray(effectsValue)) return { owner, changed: false };
	let changed = false;
	const effects = effectsValue.map((value, index) => {
		if (!isRecord(value)) return value;
		const effectName = `${scope} effect rack effect ${String(index)}`;
		const effectType = dataProperty(value, 'type', effectName);
		if (typeof effectType !== 'string' || !AUDIO_EFFECT_TYPE_SET.has(effectType)) return value;
		if (dataProperty(value, 'enabled', effectName) === false
			|| dataProperty(value, 'bypassed', effectName) === true) return value;
		if (placeholders.length >= maximumAffectedEffects) {
			throw new RangeError('Too many affected audio effects; the playback-bypass limit was exceeded.');
		}
		const effectId = stableId(dataProperty(value, 'id', effectName), `${effectName}.id`);
		boundedString(effectType, `${effectName}.type`, PROJECT_FEATURE_AUDIO_EFFECT_BYPASS_LIMITS.maximumEffectTypeLength);
		placeholders.push(Object.freeze({ scope, ownerId, effectId, effectType }));
		changed = true;
		return Object.freeze({ id: effectId, type: effectType, enabled: true, bypassed: true, params: Object.freeze({}) });
	});
	return changed
		? { owner: replaceDataProperties(owner, { effects: Object.freeze(effects) }), changed: true }
		: { owner, changed: false };
}

function stableId(value: unknown, name: string): string {
	return boundedString(value, name, PROJECT_FEATURE_AUDIO_EFFECT_BYPASS_LIMITS.maximumStableIdLength);
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
