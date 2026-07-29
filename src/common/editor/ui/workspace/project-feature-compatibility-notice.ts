/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProjectFeatureEffectiveDisposition,
	ProjectFeatureRequirementDisposition,
	ProjectFeatureRequirementsReport,
} from '../../project-feature-requirements.ts';

type AffectedAvailability = 'unavailable' | 'unknown';
type AffectedDisposition = Exclude<ProjectFeatureEffectiveDisposition, 'native'>;

interface ProjectFeatureCompatibilityCopy {
	readonly scapeCompatibilityUnavailable: string;
	readonly scapeCompatibilityUnknown: string;
	readonly scapeCompatibilityBypassed: string;
	readonly scapeCompatibilityRenderedFallback: string;
}

export interface ProjectFeatureCompatibilityNoticeItem {
	readonly requirementId: string;
	readonly featureId: string;
	readonly displayName: string;
	readonly availability: AffectedAvailability;
	readonly declaredDisposition: ProjectFeatureRequirementDisposition;
	readonly effectiveDisposition: AffectedDisposition;
}

export interface ProjectFeatureCompatibilityNotice {
	readonly counts: Readonly<Record<AffectedAvailability, number>>;
	readonly items: readonly ProjectFeatureCompatibilityNoticeItem[];
}

/** Copies only structured report fields intended for persistent UI display. */
export function createProjectFeatureCompatibilityNotice(
	report: ProjectFeatureRequirementsReport | null | undefined,
): ProjectFeatureCompatibilityNotice | null {
	if (report?.compatible !== false) return null;
	const counts = { unavailable: 0, unknown: 0 };
	const items: ProjectFeatureCompatibilityNoticeItem[] = [];
	for (const item of report.items) {
		if (item.availability === 'available') continue;
		if (item.availability !== 'unavailable' && item.availability !== 'unknown') {
			throw new RangeError('Unsupported project feature availability.');
		}
		if (item.disposition !== 'bypassed' && item.disposition !== 'rendered-fallback') {
			throw new RangeError('Unsupported unavailable project feature disposition.');
		}
		counts[item.availability] += 1;
		items.push(Object.freeze({
			requirementId: item.requirementId,
			featureId: item.featureId,
			displayName: item.displayName,
			availability: item.availability,
			declaredDisposition: item.declaredDisposition,
			effectiveDisposition: item.disposition,
		}));
	}
	if (items.length === 0) return null;
	return Object.freeze({ counts: Object.freeze(counts), items: Object.freeze(items) });
}

export function projectFeatureAvailabilityLabel(
	item: ProjectFeatureCompatibilityNoticeItem,
	copy: ProjectFeatureCompatibilityCopy,
): string {
	return item.availability === 'unknown'
		? copy.scapeCompatibilityUnknown
		: copy.scapeCompatibilityUnavailable;
}

export function projectFeatureDispositionLabel(
	item: ProjectFeatureCompatibilityNoticeItem,
	copy: ProjectFeatureCompatibilityCopy,
): string {
	return item.declaredDisposition === 'rendered-fallback'
		? copy.scapeCompatibilityRenderedFallback
		: copy.scapeCompatibilityBypassed;
}
