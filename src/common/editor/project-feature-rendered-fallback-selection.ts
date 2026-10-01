/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProjectFeatureFallback,
	ProjectFeatureFallbackKind,
	ProjectFeatureFallbackRole,
	ProjectFeatureRequirementsReport,
	ProjectFeatureRequirementsReportItem,
} from './project-feature-requirements.ts';
import { canonicalString } from './project-feature-projection-record.ts';

type AdmittedFallback<
	Kind extends ProjectFeatureFallbackKind,
	Role extends ProjectFeatureFallbackRole,
> = Extract<ProjectFeatureFallback, Readonly<{ kind: Kind; role: Role }>>;

type AdmittedItem<
	Kind extends ProjectFeatureFallbackKind,
	Role extends ProjectFeatureFallbackRole,
> = Omit<ProjectFeatureRequirementsReportItem, 'fallback'> & Readonly<{
	fallback: AdmittedFallback<Kind, Role>;
}>;

export interface ProjectFeatureRenderedFallbackSelectionOptions<
	Kind extends ProjectFeatureFallbackKind,
	Role extends ProjectFeatureFallbackRole,
	FeatureIdentity extends string,
> {
	readonly kind: Kind;
	readonly admittedRoles: readonly Role[];
	readonly qualifies: (item: AdmittedItem<Kind, Role>) => boolean;
	readonly featureIdentity: (item: AdmittedItem<Kind, Role>) => FeatureIdentity;
	readonly ambiguityDiagnostic: string;
}

export interface ProjectFeatureRenderedFallbackSelection<
	Fallback extends ProjectFeatureFallback,
	FeatureIdentity extends string,
> {
	readonly featureId: FeatureIdentity;
	readonly requirementId: string;
	readonly fallback: Fallback;
}

/** Select one qualified fallback without owning any media-specific policy. */
export function selectSingleProjectFeatureRenderedFallback<
	Kind extends ProjectFeatureFallbackKind,
	Role extends ProjectFeatureFallbackRole,
	FeatureIdentity extends string,
>(
	report: ProjectFeatureRequirementsReport | null | undefined,
	options: ProjectFeatureRenderedFallbackSelectionOptions<Kind, Role, FeatureIdentity>,
): ProjectFeatureRenderedFallbackSelection<AdmittedFallback<Kind, Role>, FeatureIdentity> | null {
	if (report?.compatible !== false || report.format !== 'soundscaper-project'
		|| !Array.isArray(report.items)) return null;
	const admittedRoles: ReadonlySet<ProjectFeatureFallbackRole> = new Set(options.admittedRoles);
	const candidates = report.items.filter((item): item is AdmittedItem<Kind, Role> => {
		const fallback = item.fallback;
		if (fallback?.kind !== options.kind || !admittedRoles.has(fallback.role)) return false;
		return options.qualifies(item as AdmittedItem<Kind, Role>);
	});
	if (candidates.length === 0) return null;
	if (candidates.length !== 1) throw new RangeError(options.ambiguityDiagnostic);
	const item = candidates[0]!;
	return Object.freeze({
		featureId: options.featureIdentity(item),
		requirementId: canonicalString(item.requirementId, 'Rendered fallback requirement ID'),
		fallback: item.fallback,
	});
}
