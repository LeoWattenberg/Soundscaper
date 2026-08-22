/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from './closed-domain-value.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from './project-feature-capabilities.ts';
import type { ProjectFeatureRequirement } from './project-feature-requirements.ts';
import {
	normalizeVideoTransitionTypeV1,
	normalizeVideoTransitionV1,
	VIDEO_TRANSITION_LIMITS_V1,
	type VideoTransitionV1,
} from './video-transition-v1.ts';

export interface VideoTransitionTypeRegistrationV1 {
	readonly type: string;
	readonly featureId: string;
	readonly requirementId: string;
	readonly displayName: string;
	readonly label: string;
	readonly resolutionContract: 'complementary-progress-v1';
	readonly previewConsumer: 'video-transition-resolution-v1';
	readonly exportConsumer: 'video-transition-resolution-v1';
}

export interface DefaultDissolveVideoTransitionInputV1 {
	readonly id: string;
	readonly outgoingClipId: string;
	readonly incomingClipId: string;
	readonly durationFrames: number;
}

const DISSOLVE_REGISTRATION = Object.freeze({
	type: 'dissolve',
	featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoTransitionDissolve,
	requirementId: 'framescaper.video-transition.dissolve',
	displayName: 'Dissolve video transitions',
	label: 'Dissolve',
	resolutionContract: 'complementary-progress-v1',
	previewConsumer: 'video-transition-resolution-v1',
	exportConsumer: 'video-transition-resolution-v1',
} satisfies VideoTransitionTypeRegistrationV1);

export const VIDEO_TRANSITION_TYPE_REGISTRY_V1 = Object.freeze([
	DISSOLVE_REGISTRATION,
] as const);

const REGISTRATION_BY_TYPE = new Map<string, VideoTransitionTypeRegistrationV1>(
	VIDEO_TRANSITION_TYPE_REGISTRY_V1.map((registration) => [registration.type, registration]),
);

export const VIDEO_TRANSITIONS_PROJECT_REQUIREMENT_V1 = Object.freeze({
	id: 'framescaper.video-transitions',
	featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoTransitions,
	displayName: 'Video transitions',
	disposition: 'bypass',
	fallback: null,
} satisfies ProjectFeatureRequirement);

export const DISSOLVE_VIDEO_TRANSITIONS_PROJECT_REQUIREMENT_V1 = Object.freeze({
	id: DISSOLVE_REGISTRATION.requirementId,
	featureId: DISSOLVE_REGISTRATION.featureId,
	displayName: DISSOLVE_REGISTRATION.displayName,
	disposition: 'bypass',
	fallback: null,
} satisfies ProjectFeatureRequirement);

/** Look up maintained executable behavior without changing structural validity. */
export function videoTransitionTypeRegistrationV1(
	typeValue: unknown,
): VideoTransitionTypeRegistrationV1 | null {
	const type = normalizeVideoTransitionTypeV1(typeValue);
	return REGISTRATION_BY_TYPE.get(type) ?? null;
}

export function requireVideoTransitionTypeRegistrationV1(
	typeValue: unknown,
): VideoTransitionTypeRegistrationV1 {
	const type = normalizeVideoTransitionTypeV1(typeValue);
	const registration = REGISTRATION_BY_TYPE.get(type);
	if (!registration) throw new RangeError(`Video transition type ${type} is unregistered and unavailable.`);
	return registration;
}

export function videoTransitionTypeFeatureIdV1(typeValue: unknown): string {
	return `org.soundscaper.capability.video-transition.${normalizeVideoTransitionTypeV1(typeValue)}`;
}

/** Derive exact owned bypass requirements from a nonempty transition inventory. */
export function videoTransitionFeatureRequirementsV1(
	transitionValues: unknown,
): readonly ProjectFeatureRequirement[] {
	const values = readClosedDomainArray(
		transitionValues,
		'video transitions',
		0,
		VIDEO_TRANSITION_LIMITS_V1.maximumTransitionsPerProject,
	);
	if (values.length === 0) return Object.freeze([]);
	const types = new Set<string>();
	for (const [index, value] of values.entries()) {
		types.add(normalizeVideoTransitionV1(value, `video transitions[${String(index)}]`).type);
	}
	const requirements = [...types].sort().map((type) => transitionTypeRequirement(type));
	return Object.freeze([VIDEO_TRANSITIONS_PROJECT_REQUIREMENT_V1, ...requirements]);
}

/** Create only the canonical authored default; all stable identities remain caller-owned. */
export function createDefaultDissolveVideoTransitionV1(
	value: unknown,
): VideoTransitionV1 {
	const name = 'default dissolve transition input';
	const input = readClosedDomainRecord(value, name, [
		'id', 'outgoingClipId', 'incomingClipId', 'durationFrames',
	]);
	const id = readClosedDomainField(input, 'id', name);
	const outgoingClipId = readClosedDomainField(input, 'outgoingClipId', name);
	const incomingClipId = readClosedDomainField(input, 'incomingClipId', name);
	const durationFrames = readClosedDomainField(input, 'durationFrames', name);
	return normalizeVideoTransitionV1({
		schemaVersion: 1,
		id,
		type: 'dissolve',
		outgoingClipId,
		incomingClipId,
		alignment: 'center-on-cut',
		durationFrames,
		curve: {
			anchors: [
				{ position: { num: 0, den: 1 }, value: 0 },
				{ position: { num: durationFrames, den: 1 }, value: 1 },
			],
			segments: [{ kind: 'linear' }],
		},
	}, 'default dissolve transition');
}

function transitionTypeRequirement(type: string): ProjectFeatureRequirement {
	const registration = REGISTRATION_BY_TYPE.get(type);
	if (registration?.type === 'dissolve') {
		return DISSOLVE_VIDEO_TRANSITIONS_PROJECT_REQUIREMENT_V1;
	}
	return Object.freeze({
		id: `framescaper.video-transition.${type}`,
		featureId: videoTransitionTypeFeatureIdV1(type),
		displayName: `Video transition type: ${type}`,
		disposition: 'bypass' as const,
		fallback: null,
	});
}
