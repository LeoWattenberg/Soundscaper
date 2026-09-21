/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProjectFeatureFallback,
	ProjectFeatureFallbackKind,
	ProjectFeatureRequirement,
} from './project-feature-requirements.ts';

export interface ProjectFallbackSelectorIdentity<Kind extends ProjectFeatureFallbackKind> {
	readonly requirementId: string;
	readonly featureId: string;
	readonly role: string;
	readonly kind: Kind;
	readonly sourceId: string;
	readonly sha256: string;
}

export interface ProjectFallbackSelectorSource {
	readonly id: string;
	readonly kind?: ProjectFeatureFallbackKind;
}

interface SnapshotProjectFallbackSelectorOptions<
	Kind extends ProjectFeatureFallbackKind,
	TargetKey extends string,
> {
	readonly kind: Kind;
	readonly targetKey: TargetKey;
	readonly invalidMessage: string;
	readonly validRelationship: (role: unknown, targetId: unknown) => boolean;
}

interface SelectProjectFallbackTargetOptions<
	Kind extends ProjectFeatureFallbackKind,
	Selector extends ProjectFallbackSelectorIdentity<Kind>,
> {
	readonly mismatchMessage: string;
	readonly sameRelationship: (claim: ProjectFeatureFallback, selector: Selector) => boolean;
}

export function snapshotProjectFallbackSelector<
	Kind extends ProjectFeatureFallbackKind,
	TargetKey extends string,
	Selector extends ProjectFallbackSelectorIdentity<Kind> & Readonly<Record<TargetKey, unknown>>,
>(
	value: unknown,
	options: SnapshotProjectFallbackSelectorOptions<Kind, TargetKey>,
): Selector {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(options.invalidMessage);
	}
	const selector = value as Record<PropertyKey, unknown>;
	const captured = Object.freeze({
		requirementId: ownData(selector, 'requirementId', options.invalidMessage),
		featureId: ownData(selector, 'featureId', options.invalidMessage),
		role: ownData(selector, 'role', options.invalidMessage),
		kind: ownData(selector, 'kind', options.invalidMessage),
		sourceId: ownData(selector, 'sourceId', options.invalidMessage),
		sha256: ownData(selector, 'sha256', options.invalidMessage),
		[options.targetKey]: ownData(selector, options.targetKey, options.invalidMessage),
	});
	if (typeof captured.requirementId !== 'string' || !captured.requirementId
		|| typeof captured.featureId !== 'string' || !captured.featureId
		|| captured.kind !== options.kind
		|| typeof captured.sourceId !== 'string' || !captured.sourceId
		|| typeof captured.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(captured.sha256)
		|| !options.validRelationship(captured.role, captured[options.targetKey])) {
		throw new TypeError(options.invalidMessage);
	}
	return captured as unknown as Selector;
}

export function selectProjectFallbackTarget<
	Kind extends ProjectFeatureFallbackKind,
	Selector extends ProjectFallbackSelectorIdentity<Kind>,
	Source extends ProjectFallbackSelectorSource,
>(
	requirements: readonly ProjectFeatureRequirement[],
	sources: readonly Source[],
	selector: Selector,
	options: SelectProjectFallbackTargetOptions<Kind, Selector>,
): Readonly<{ claim: ProjectFeatureFallback; source: Source }> {
	const requirement = uniqueById(requirements, selector.requirementId);
	const fallback = requirement?.fallback;
	const source = uniqueById(sources, selector.sourceId);
	const conflictingClaim = requirements.some((candidate) => (
		candidate.fallback?.sourceId === selector.sourceId
		&& (!options.sameRelationship(candidate.fallback, selector)
			|| candidate.fallback.kind !== selector.kind
			|| candidate.fallback.sha256 !== selector.sha256)
	));
	if (!requirement || requirement.featureId !== selector.featureId
		|| requirement.disposition !== 'rendered-fallback' || fallback?.kind !== selector.kind
		|| !options.sameRelationship(fallback, selector)
		|| fallback.sourceId !== selector.sourceId || fallback.sha256 !== selector.sha256
		|| !source || source.kind !== selector.kind || conflictingClaim) {
		throw new Error(options.mismatchMessage);
	}
	return Object.freeze({ claim: fallback, source });
}

export function sameProjectFallbackSelector<
	Kind extends ProjectFeatureFallbackKind,
	Selector extends ProjectFallbackSelectorIdentity<Kind>,
>(
	left: Selector,
	right: Selector,
	sameTarget: (left: Selector, right: Selector) => boolean,
): boolean {
	return left.requirementId === right.requirementId && left.featureId === right.featureId
		&& left.role === right.role && left.kind === right.kind
		&& left.sourceId === right.sourceId && left.sha256 === right.sha256
		&& sameTarget(left, right);
}

function ownData(
	record: Record<PropertyKey, unknown>,
	key: PropertyKey,
	invalidMessage: string,
): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor || !('value' in descriptor)) throw new TypeError(invalidMessage);
	return descriptor.value;
}

function uniqueById<Value extends Readonly<{ id: string }>>(
	values: readonly Value[],
	id: string,
): Value | undefined {
	const matches = values.filter((candidate) => candidate.id === id);
	return matches.length === 1 ? matches[0] : undefined;
}
