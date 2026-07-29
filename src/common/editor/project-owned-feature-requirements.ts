/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PROJECT_FEATURE_AUDIO_EFFECT_TYPES,
	PROJECT_FEATURE_CAPABILITY_IDS,
} from './project-feature-capabilities.ts';
import type {
	ProjectFeatureRequirement,
	ProjectFeatureRequirementsManifest,
} from './project-feature-requirements.ts';
import { PROJECT_FEATURE_REQUIREMENTS_LIMITS } from './project-feature-requirements.ts';
import { VIDEO_EFFECT_TYPES } from './video-effects.js';

export const PROJECT_OWNED_FEATURE_REQUIREMENT_IDS = Object.freeze({
	audioEffects: 'soundscaper.audio-effects',
	videoEffects: 'soundscaper.video-effects',
} as const);

type RecordValue = Readonly<Record<string, unknown>>;

interface OwnedFeatureRequirement {
	readonly requirement: ProjectFeatureRequirement;
	readonly conflictMessage: string;
	readonly projectNeedsRequirement: (project: Readonly<Record<string, unknown>>) => boolean;
}

const AUDIO_EFFECT_TYPE_SET: ReadonlySet<string> = new Set(PROJECT_FEATURE_AUDIO_EFFECT_TYPES);
const VIDEO_EFFECT_TYPE_SET: ReadonlySet<string> = new Set(VIDEO_EFFECT_TYPES as readonly string[]);
const OWNED_AUDIO_EFFECT_REQUIREMENT: ProjectFeatureRequirement = Object.freeze({
	id: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.audioEffects,
	featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
	displayName: 'Audio effects',
	disposition: 'bypass',
	fallback: null,
});
const OWNED_VIDEO_EFFECT_REQUIREMENT: ProjectFeatureRequirement = Object.freeze({
	id: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.videoEffects,
	featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
	displayName: 'Video effects',
	disposition: 'bypass',
	fallback: null,
});
const OWNED_FEATURE_REQUIREMENTS: readonly OwnedFeatureRequirement[] = Object.freeze([
	Object.freeze({
		requirement: OWNED_AUDIO_EFFECT_REQUIREMENT,
		conflictMessage: 'The reserved owned audio-effects requirement conflicts with publisher data.',
		projectNeedsRequirement: projectHasMaintainedAudioEffects,
	}),
	Object.freeze({
		requirement: OWNED_VIDEO_EFFECT_REQUIREMENT,
		conflictMessage: 'The reserved owned video-effects requirement conflicts with publisher data.',
		projectNeedsRequirement: projectHasMaintainedVideoEffects,
	}),
]);

/**
 * Keep editor-owned declarations aligned with maintained effect state. A
 * publisher-owned declaration for the same feature always wins.
 */
export function reconcileProjectOwnedFeatureRequirements(
	project: Readonly<Record<string, unknown>>,
	manifest: ProjectFeatureRequirementsManifest,
): ProjectFeatureRequirementsManifest {
	let reconciled = manifest;
	for (const owned of OWNED_FEATURE_REQUIREMENTS) {
		reconciled = reconcileOwnedFeatureRequirement(project, reconciled, owned);
	}
	return reconciled;
}

function reconcileOwnedFeatureRequirement(
	project: Readonly<Record<string, unknown>>,
	manifest: ProjectFeatureRequirementsManifest,
	owned: OwnedFeatureRequirement,
): ProjectFeatureRequirementsManifest {
	const requirement = owned.requirement;
	const ownedIndex = manifest.requirements.findIndex(
		(candidate) => candidate.id === requirement.id,
	);
	if (ownedIndex >= 0 && !ownedRequirementMatches(manifest.requirements[ownedIndex], requirement)) {
		throw new TypeError(owned.conflictMessage);
	}
	const explicitRequirement = manifest.requirements.some((candidate) => (
		candidate.id !== requirement.id
		&& candidate.featureId === requirement.featureId
	));
	const needsOwnedRequirement = !explicitRequirement && owned.projectNeedsRequirement(project);
	if (needsOwnedRequirement && ownedIndex >= 0) return manifest;
	if (!needsOwnedRequirement && ownedIndex < 0) return manifest;

	const requirements = manifest.requirements.filter(
		(candidate) => candidate.id !== requirement.id,
	);
	if (needsOwnedRequirement) {
		if (requirements.length >= PROJECT_FEATURE_REQUIREMENTS_LIMITS.maximumRequirements) {
			throw new RangeError('Owned project feature requirements exceed the manifest limit.');
		}
		requirements.push(requirement);
	}
	return Object.freeze({
		schemaVersion: manifest.schemaVersion,
		requirements: Object.freeze(requirements),
	});
}

function ownedRequirementMatches(
	actual: ProjectFeatureRequirement | undefined,
	expected: ProjectFeatureRequirement,
): boolean {
	return Boolean(
		actual
		&& actual.featureId === expected.featureId
		&& actual.displayName === expected.displayName
		&& actual.disposition === expected.disposition
		&& actual.fallback === null,
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

function projectHasMaintainedVideoEffects(project: Readonly<Record<string, unknown>>): boolean {
	if (clipCollectionHasMaintainedVideoEffects(dataArray(project, 'clips'))) return true;
	const projectBin = dataProperty(project, 'projectBin');
	return isRecord(projectBin)
		&& clipCollectionHasMaintainedVideoEffects(dataArray(projectBin, 'clips'));
}

function clipCollectionHasMaintainedVideoEffects(clips: readonly unknown[]): boolean {
	for (const clip of clips) {
		if (!isRecord(clip) || dataProperty(clip, 'kind') !== 'video') continue;
		for (const effect of dataArray(clip, 'videoEffects')) {
			if (!isRecord(effect)) continue;
			const type = dataProperty(effect, 'type');
			if (typeof type === 'string' && VIDEO_EFFECT_TYPE_SET.has(type)) return true;
		}
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
