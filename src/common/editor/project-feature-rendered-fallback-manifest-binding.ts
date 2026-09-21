/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProjectFeatureAudioMixFallback,
	ProjectFeatureAudioTrackRenderFallback,
	ProjectFeatureVideoClipRenderFallback,
	ProjectFeatureVideoRenderFallback,
} from './project-feature-requirement-types.ts';

export type ProjectFeatureRenderedFallbackManifestBinding =
	| Readonly<{
		readonly featureId: string;
		readonly requirementId: string;
		readonly fallback: ProjectFeatureAudioMixFallback;
	}>
	| Readonly<{
		readonly featureId: string;
		readonly requirementId: string;
		readonly fallback: ProjectFeatureAudioTrackRenderFallback;
	}>
	| Readonly<{
		readonly featureId: string;
		readonly requirementId: string;
		readonly fallback: ProjectFeatureVideoRenderFallback;
	}>
	| Readonly<{
		readonly featureId: string;
		readonly requirementId: string;
		readonly fallback: ProjectFeatureVideoClipRenderFallback;
	}>;

type RecordValue = Readonly<Record<string, unknown>>;

/** Prove that a reported rendered fallback is still bound to its manifest entry. */
export function assertProjectFeatureRenderedFallbackManifestBinding(
	project: unknown,
	descriptor: ProjectFeatureRenderedFallbackManifestBinding,
): void {
	const projectRecord = recordValue(project, 'project');
	const manifest = recordValue(
		dataProperty(projectRecord, 'featureRequirements', 'project'),
		'project.featureRequirements',
	);
	const requirements = arrayValue(
		dataProperty(manifest, 'requirements', 'project.featureRequirements'),
		'project.featureRequirements.requirements',
	);
	const matches = requirements.filter((candidate, index) => isRecord(candidate)
		&& dataProperty(candidate, 'id', `project.featureRequirements.requirements[${String(index)}]`)
			=== descriptor.requirementId);
	if (matches.length !== 1) {
		throw new Error('The rendered fallback descriptor does not match one project manifest requirement.');
	}
	const requirement = matches[0]! as RecordValue;
	const fallback = recordValue(
		dataProperty(requirement, 'fallback', 'project feature requirement'),
		'project feature requirement fallback',
	);
	const matchesBase = dataProperty(requirement, 'featureId', 'project feature requirement')
			=== descriptor.featureId
		&& dataProperty(requirement, 'disposition', 'project feature requirement') === 'rendered-fallback'
		&& dataProperty(fallback, 'role', 'project feature requirement fallback') === descriptor.fallback.role
		&& dataProperty(fallback, 'kind', 'project feature requirement fallback') === descriptor.fallback.kind
		&& dataProperty(fallback, 'sourceId', 'project feature requirement fallback') === descriptor.fallback.sourceId
		&& dataProperty(fallback, 'sha256', 'project feature requirement fallback') === descriptor.fallback.sha256;
	let matchesRelationship: boolean;
	switch (descriptor.fallback.role) {
		case 'audio-track-render-v1':
			matchesRelationship = dataProperty(fallback, 'targetTrackId', 'project feature requirement fallback')
				=== descriptor.fallback.targetTrackId;
			break;
		case 'video-clip-render-v1':
			matchesRelationship = dataProperty(fallback, 'targetClipId', 'project feature requirement fallback')
				=== descriptor.fallback.targetClipId;
			break;
		case 'project-audio-mix-v1':
		case 'project-video-render-v1':
			matchesRelationship = true;
			break;
	}
	if (!matchesBase || !matchesRelationship) {
		throw new Error('The rendered fallback descriptor does not match the project manifest.');
	}
}

function isRecord(value: unknown): value is RecordValue {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function recordValue(value: unknown, name: string): RecordValue {
	if (!isRecord(value)) throw new TypeError(`${name} must be an object.`);
	return value;
}

function arrayValue(value: unknown, name: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value;
}

function dataProperty(value: RecordValue, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own data property.`);
	}
	return descriptor.value;
}
