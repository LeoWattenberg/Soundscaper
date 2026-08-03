/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProjectFeatureFallback,
	ProjectFeatureRequirement,
} from './project-feature-requirements.ts';
import { PROJECT_FEATURE_REQUIREMENTS_LIMITS } from './project-feature-requirements.ts';

interface ProjectVideoFallbackSource {
	readonly id: string;
	readonly kind?: 'audio' | 'video';
}

interface ProjectVideoFallbackIntegritySelectorBase {
	readonly requirementId: string;
	readonly featureId: string;
	readonly kind: 'video';
	readonly sourceId: string;
	readonly sha256: string;
}

export type ProjectVideoFallbackIntegritySelector = ProjectVideoFallbackIntegritySelectorBase & (
	| Readonly<{ role: 'project-video-render-v1'; targetClipId: null }>
	| Readonly<{ role: 'video-clip-render-v1'; targetClipId: string }>
);

export function snapshotProjectVideoFallbackSelector(
	value: unknown,
): ProjectVideoFallbackIntegritySelector {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('The selected video rendered fallback is invalid.');
	}
	const selector = value as Record<PropertyKey, unknown>;
	const captured = Object.freeze({
		requirementId: ownData(selector, 'requirementId'),
		featureId: ownData(selector, 'featureId'),
		role: ownData(selector, 'role'),
		kind: ownData(selector, 'kind'),
		sourceId: ownData(selector, 'sourceId'),
		sha256: ownData(selector, 'sha256'),
		targetClipId: ownData(selector, 'targetClipId'),
	});
	if (typeof captured.requirementId !== 'string' || !captured.requirementId
		|| typeof captured.featureId !== 'string' || !captured.featureId
		|| captured.kind !== 'video'
		|| typeof captured.sourceId !== 'string' || !captured.sourceId
		|| typeof captured.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(captured.sha256)
		|| !validRelationship(captured.role, captured.targetClipId)) {
		throw new TypeError('The selected video rendered fallback is invalid.');
	}
	return captured as ProjectVideoFallbackIntegritySelector;
}

export function selectProjectVideoFallbackTarget<Source extends ProjectVideoFallbackSource>(
	requirements: readonly ProjectFeatureRequirement[],
	sources: readonly Source[],
	selector: ProjectVideoFallbackIntegritySelector,
): Readonly<{ claim: ProjectFeatureFallback; source: Source }> {
	const matches = requirements.filter(({ id }) => id === selector.requirementId);
	const requirement = matches.length === 1 ? matches[0] : undefined;
	const fallback = requirement?.fallback;
	const sourceMatches = sources.filter(({ id }) => id === selector.sourceId);
	const source = sourceMatches.length === 1 ? sourceMatches[0] : undefined;
	const conflictingClaim = requirements.some((candidate) => candidate.fallback?.sourceId === selector.sourceId
		&& (!sameRelationship(candidate.fallback, selector)
			|| candidate.fallback.kind !== selector.kind
			|| candidate.fallback.sha256 !== selector.sha256));
	if (!requirement || requirement.featureId !== selector.featureId
		|| requirement.disposition !== 'rendered-fallback' || fallback?.kind !== selector.kind
		|| !sameRelationship(fallback, selector)
		|| fallback.sourceId !== selector.sourceId || fallback.sha256 !== selector.sha256
		|| !source || source.kind !== selector.kind || conflictingClaim) {
		throw new Error('The selected video rendered fallback does not match one active project requirement and source claim.');
	}
	return Object.freeze({ claim: fallback, source });
}

export function projectVideoFallbackSelectorMatches(
	requirements: readonly ProjectFeatureRequirement[],
	sources: readonly ProjectVideoFallbackSource[],
	selector: ProjectVideoFallbackIntegritySelector,
): boolean {
	try {
		selectProjectVideoFallbackTarget(requirements, sources, selector);
		return true;
	} catch {
		return false;
	}
}

export function sameProjectVideoFallbackSelector(
	left: ProjectVideoFallbackIntegritySelector,
	right: ProjectVideoFallbackIntegritySelector,
): boolean {
	return left.requirementId === right.requirementId && left.featureId === right.featureId
		&& left.role === right.role && left.kind === right.kind
		&& left.sourceId === right.sourceId && left.sha256 === right.sha256
		&& left.targetClipId === right.targetClipId;
}

function validRelationship(role: unknown, targetClipId: unknown): boolean {
	if (role === 'project-video-render-v1') return targetClipId === null;
	return role === 'video-clip-render-v1' && typeof targetClipId === 'string'
		&& targetClipId.length <= PROJECT_FEATURE_REQUIREMENTS_LIMITS.maximumSourceIdLength
		&& targetClipId.length > 0 && targetClipId === targetClipId.trim()
		&& !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(targetClipId);
}

function sameRelationship(
	claim: ProjectFeatureFallback,
	selector: ProjectVideoFallbackIntegritySelector,
): boolean {
	return claim.role === selector.role
		&& (claim.role === 'video-clip-render-v1' ? claim.targetClipId : null) === selector.targetClipId;
}

function ownData(record: Record<PropertyKey, unknown>, key: PropertyKey): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor || !('value' in descriptor)) {
		throw new TypeError('The selected video rendered fallback is invalid.');
	}
	return descriptor.value;
}
