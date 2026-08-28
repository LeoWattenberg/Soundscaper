/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
	isCurrentProjectSchemaIdentity,
} from './project-schema-identity.ts';

export { PROJECT_SCHEMA_VERSION } from './project-schema-identity.ts';

/**
 * The shared editorial foundation remains an internal implementation contract.
 * It is never a persisted product identity: product loaders accept only a
 * family-qualified v1 tuple and reject numeric-only documents.
 */
export const AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION = 17 as const;
export const AUDIO_EDITOR_PROJECT_SCHEMA_VERSION = AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION;
export const AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION = AUDIO_EDITOR_PROJECT_SCHEMA_VERSION;

/** A family-qualified 1.0 document that retains the shared editorial foundation. */
export function isBaselineFoundationProject(value: unknown): boolean {
	return isCurrentProjectSchemaIdentity(value, SOUNDSCAPER_PROJECT_SCHEMA_FAMILY)
		|| isCurrentProjectSchemaIdentity(value, FRAMESCAPER_PROJECT_SCHEMA_FAMILY);
}

/** Project owns immutable sample editing, grouping, snap, metadata, and display state. */
export function hasCoreEditingProjectAuthority(value: unknown): boolean {
	return isBaselineFoundationProject(value) || isInternalFoundationProject(value);
}

/** Project owns typed bin items, A/V links, and media-kind constrained tracks. */
export function hasProjectBinMediaAuthority(value: unknown): boolean {
	return hasCoreEditingProjectAuthority(value);
}

/** Project owns clip-level video effects. */
export function hasVideoEffectsProjectAuthority(value: unknown): boolean {
	return hasCoreEditingProjectAuthority(value);
}

/** Project metadata supports the BWF bext namespace. */
export function hasBextMetadataProjectAuthority(value: unknown): boolean {
	return hasCoreEditingProjectAuthority(value);
}

/** Project metadata supports ADM programme and object namespaces. */
export function hasAdmMetadataProjectAuthority(value: unknown): boolean {
	return hasCoreEditingProjectAuthority(value);
}

/** Project owns sequence/video-grid coordinate authority. */
export function hasSequenceGeometryProjectAuthority(value: unknown): boolean {
	return hasCoreEditingProjectAuthority(value);
}

/** Project owns sequence-scoped structural hierarchy. */
export function hasSequenceHierarchyProjectAuthority(value: unknown): boolean {
	return hasCoreEditingProjectAuthority(value);
}

/** Exact Soundscaper 1.0 production authority, disambiguated from Framescaper v1. */
export function isSoundscaperProductionProject(value: unknown): boolean {
	return isCurrentProjectSchemaIdentity(value, SOUNDSCAPER_PROJECT_SCHEMA_FAMILY);
}

/** Explicit shared mixer capability carried by either current product family. */
export function hasProductionMixerProjectAuthority(value: unknown): boolean {
	if (!isBaselineFoundationProject(value) || !isRecord(value)) return false;
	const mixer = dataValue(value, 'mixer');
	const automationLanes = dataValue(value, 'automationLanes');
	return isRecord(mixer) && Array.isArray(automationLanes);
}

/** Exact Soundscaper mastering capability; the family tuple remains authoritative. */
export function hasMasteringSequenceProjectAuthority(value: unknown): boolean {
	return isSoundscaperProductionProject(value)
		&& isRecord(value)
		&& Array.isArray(dataValue(value, 'masteringSequences'));
}

/** Current family-qualified documents whose rendered fallbacks remain maintained. */
export function isBaselineRenderedFallbackProject(value: unknown): boolean {
	return isBaselineFoundationProject(value);
}

/** Shared command foundation: family identity or the in-memory V17 factory product. */
export function isFoundationProjectSchema(value: unknown): boolean {
	return isBaselineFoundationProject(value) || isInternalFoundationProject(value);
}

/** Compatibility alias retained for shared callers; numbers carry no product authority. */
export function isSoundscaperProductionProjectSchema(value: unknown): boolean {
	return isSoundscaperProductionProject(value);
}

/** Mixer behavior is selected from explicit document capability, never a version number. */
export function isProductionMixerProjectSchema(value: unknown): boolean {
	return hasProductionMixerProjectAuthority(value);
}

/** Selected Framescaper authority, identified by its family-qualified tuple. */
export function isSelectedFramescaperProjectSchema(value: unknown): boolean {
	return isFramescaperProject(value);
}

/** Framescaper v1 owns the maintained video-proxy lifecycle. */
export function isFramescaperVideoProxyProjectSchema(value: unknown): boolean {
	return isFramescaperProject(value);
}

/** Soundscaper v1 owns mastering sequences when the collection is present. */
export function isMasteringSequenceProjectSchema(value: unknown): boolean {
	return hasMasteringSequenceProjectAuthority(value);
}

/** Framescaper v1 owns nested-sequence and multicamera graphs. */
export function isFramescaperSequenceProjectSchema(value: unknown): boolean {
	return isFramescaperProject(value);
}

/** Framescaper v1 owns the capture contract. */
export function isFramescaperCaptureProjectSchema(value: unknown): boolean {
	return isFramescaperProject(value);
}

/** Framescaper v1 owns explicit clip composition state. */
export function isFramescaperVideoCompositionProjectSchema(value: unknown): boolean {
	return isFramescaperProject(value);
}

/** Framescaper v1 owns explicit video-keyframe curves. */
export function isFramescaperVideoKeyframeProjectSchema(value: unknown): boolean {
	return isFramescaperProject(value);
}

/** Framescaper v1 owns maintained occurrence-retime authoring. */
export function isFramescaperVideoRetimeProjectSchema(value: unknown): boolean {
	return isFramescaperProject(value);
}

/** Active product documents and the internal foundation factory support audio authoring. */
export function isActiveAudioEditorProjectSchema(value: unknown): boolean {
	return isFoundationProjectSchema(value);
}

export function isTimelineAnnotationProjectSchema(value: unknown): boolean {
	return isFoundationProjectSchema(value);
}

export function isTrackFolderProjectSchema(value: unknown): boolean {
	return isFoundationProjectSchema(value);
}

export function isSourceCharacteristicsProjectSchema(value: unknown): boolean {
	return isFoundationProjectSchema(value);
}

export function isTrackLockProjectSchema(value: unknown): boolean {
	return isFoundationProjectSchema(value);
}

export function isVideoRetimeCurveProjectSchema(value: unknown): boolean {
	return isFoundationProjectSchema(value);
}

export function isTakeCompProjectSchema(value: unknown): boolean {
	return isFoundationProjectSchema(value);
}

export function isAudioWarpProjectSchema(value: unknown): boolean {
	return isFoundationProjectSchema(value);
}

/** Maintained feature manifests belong to the current tuple or internal factory product. */
export function isMaintainedProjectFeatureSchema(value: unknown): boolean {
	return isFoundationProjectSchema(value);
}

export function isMaintainedRenderedFallbackProjectSchema(value: unknown): boolean {
	return isBaselineRenderedFallbackProject(value) || isInternalFoundationProject(value);
}

function isFramescaperProject(value: unknown): boolean {
	return isCurrentProjectSchemaIdentity(value, FRAMESCAPER_PROJECT_SCHEMA_FAMILY);
}

/**
 * Recognize only the complete object emitted inside the shared V17 factory.
 * A bare number or {schemaVersion: 17} shell is intentionally insufficient.
 */
function isInternalFoundationProject(value: unknown): boolean {
	if (!isRecord(value) || dataValue(value, 'schemaVersion') !== AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION) {
		return false;
	}
	if (Object.getOwnPropertyDescriptor(value, 'schemaFamily')) return false;
	return ['sources', 'clips', 'tracks', 'sequences', 'timelineAnnotations', 'trackFolders', 'takeGroups']
		.some((key) => Array.isArray(dataValue(value, key)))
		|| ['selection', 'featureRequirements', 'sampleRate', 'projectBin', 'mixer']
			.some((key) => dataValue(value, key) !== undefined);
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function dataValue(value: Record<PropertyKey, unknown>, key: PropertyKey): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
		? descriptor.value
		: undefined;
}
