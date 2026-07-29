/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PROJECT_FEATURE_AUDIO_EFFECT_TYPES,
	PROJECT_FEATURE_CAPABILITY_IDS,
} from './project-feature-capabilities.ts';
import type {
	ProjectFeatureRequirement,
	ProjectFeatureRequirementsManifest,
} from './project-feature-requirements.ts';

export const PROJECT_OWNED_FEATURE_REQUIREMENT_IDS = Object.freeze({
	audioEffects: 'soundscaper.audio-effects',
} as const);

type RecordValue = Readonly<Record<string, unknown>>;

const AUDIO_EFFECT_TYPE_SET: ReadonlySet<string> = new Set(PROJECT_FEATURE_AUDIO_EFFECT_TYPES);
const OWNED_AUDIO_EFFECT_REQUIREMENT: ProjectFeatureRequirement = Object.freeze({
	id: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.audioEffects,
	featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
	displayName: 'Audio effects',
	disposition: 'bypass',
	fallback: null,
});

/**
 * Keep the editor-owned audio-effects declaration aligned with maintained rack
 * state. A publisher-owned declaration for the same feature always wins.
 */
export function reconcileProjectOwnedFeatureRequirements(
	project: Readonly<Record<string, unknown>>,
	manifest: ProjectFeatureRequirementsManifest,
): ProjectFeatureRequirementsManifest {
	const ownedIndex = manifest.requirements.findIndex(
		(requirement) => requirement.id === PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.audioEffects,
	);
	if (ownedIndex >= 0 && !ownedAudioEffectRequirement(manifest.requirements[ownedIndex])) {
		throw new TypeError('The reserved owned audio-effects requirement conflicts with publisher data.');
	}
	const explicitAudioRequirement = manifest.requirements.some((requirement) => (
		requirement.id !== PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.audioEffects
		&& requirement.featureId === PROJECT_FEATURE_CAPABILITY_IDS.audioEffects
	));
	const needsOwnedRequirement = !explicitAudioRequirement && projectHasMaintainedAudioEffects(project);
	if (needsOwnedRequirement && ownedIndex >= 0) return manifest;
	if (!needsOwnedRequirement && ownedIndex < 0) return manifest;

	const requirements = manifest.requirements.filter(
		(requirement) => requirement.id !== PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.audioEffects,
	);
	if (needsOwnedRequirement) requirements.push(OWNED_AUDIO_EFFECT_REQUIREMENT);
	return Object.freeze({
		schemaVersion: manifest.schemaVersion,
		requirements: Object.freeze(requirements),
	});
}

function ownedAudioEffectRequirement(
	requirement: ProjectFeatureRequirement | undefined,
): boolean {
	return Boolean(
		requirement
		&& requirement.featureId === OWNED_AUDIO_EFFECT_REQUIREMENT.featureId
		&& requirement.displayName === OWNED_AUDIO_EFFECT_REQUIREMENT.displayName
		&& requirement.disposition === OWNED_AUDIO_EFFECT_REQUIREMENT.disposition
		&& requirement.fallback === null,
	);
}

function projectHasMaintainedAudioEffects(project: Readonly<Record<string, unknown>>): boolean {
	const tracks = dataArray(project, 'tracks');
	for (const track of tracks) {
		if (!isRecord(track)) continue;
		const type = dataProperty(track, 'type');
		if (type === 'label' || type === 'video') continue;
		if (rackHasMaintainedAudioEffect(track)) return true;
	}
	const mixer = dataProperty(project, 'mixer');
	if (isRecord(mixer)) {
		for (const key of ['groups', 'sends']) {
			for (const owner of dataArray(mixer, key)) {
				if (isRecord(owner) && rackHasMaintainedAudioEffect(owner)) return true;
			}
		}
	}
	const master = dataProperty(project, 'master');
	return isRecord(master) && rackHasMaintainedAudioEffect(master);
}

function rackHasMaintainedAudioEffect(owner: RecordValue): boolean {
	for (const effect of dataArray(owner, 'effects')) {
		if (!isRecord(effect)) continue;
		const type = dataProperty(effect, 'type');
		if (typeof type === 'string' && AUDIO_EFFECT_TYPE_SET.has(type)) return true;
	}
	return false;
}

function dataArray(value: RecordValue, key: string): readonly unknown[] {
	const candidate = dataProperty(value, key);
	return Array.isArray(candidate) ? candidate : [];
}

function dataProperty(value: RecordValue, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) return undefined;
	if (!Object.hasOwn(descriptor, 'value')) throw new TypeError(`Project ${key} must be a data property.`);
	return descriptor.value;
}

function isRecord(value: unknown): value is RecordValue {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

