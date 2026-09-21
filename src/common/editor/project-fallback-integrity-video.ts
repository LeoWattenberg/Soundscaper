/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProjectFeatureFallback,
	ProjectFeatureRequirement,
} from './project-feature-requirements.ts';
import { PROJECT_FEATURE_REQUIREMENTS_LIMITS } from './project-feature-requirements.ts';
import {
	sameProjectFallbackSelector,
	selectProjectFallbackTarget,
	snapshotProjectFallbackSelector,
} from './project-fallback-selector-integrity-core.ts';

const INVALID_VIDEO_FALLBACK_SELECTOR = 'The selected video rendered fallback is invalid.';
const VIDEO_FALLBACK_SELECTOR_MISMATCH = 'The selected video rendered fallback does not match one active project requirement and source claim.';

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
	return snapshotProjectFallbackSelector(value, {
		kind: 'video',
		targetKey: 'targetClipId',
		invalidMessage: INVALID_VIDEO_FALLBACK_SELECTOR,
		validRelationship,
	});
}

export function selectProjectVideoFallbackTarget<Source extends ProjectVideoFallbackSource>(
	requirements: readonly ProjectFeatureRequirement[],
	sources: readonly Source[],
	selector: ProjectVideoFallbackIntegritySelector,
): Readonly<{ claim: ProjectFeatureFallback; source: Source }> {
	return selectProjectFallbackTarget(requirements, sources, selector, {
		mismatchMessage: VIDEO_FALLBACK_SELECTOR_MISMATCH,
		sameRelationship,
	});
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
	return sameProjectFallbackSelector(left, right, (leftSelector, rightSelector) => (
		leftSelector.targetClipId === rightSelector.targetClipId
	));
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
