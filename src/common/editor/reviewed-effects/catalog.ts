/* SPDX-License-Identifier: AGPL-3.0-only */

import { reviewedEffectError } from './errors.ts';
import {
	defineReviewedEffectManifest,
	normalizeReviewedEffectPackageReference,
	reviewedEffectPackageKey,
	type ReviewedEffectManifest,
} from './manifest.ts';
import {
	UTILITY_GAIN_MANIFEST,
	UTILITY_GAIN_PACKAGE_SHA256,
	utilityGainPackageBytes,
} from './utility-gain-package.ts';

export const REVIEWED_EFFECT_CATALOG_RELEASE = 'soundscaper-1.0.0-rc.1' as const;

interface CatalogBase {
	readonly catalogRelease: typeof REVIEWED_EFFECT_CATALOG_RELEASE;
	readonly manifest: ReviewedEffectManifest;
	readonly sha256: string;
	readonly realtimeApproved: boolean;
}

export interface ApprovedReviewedEffectCatalogEntry extends CatalogBase {
	readonly state: 'approved';
}

export interface RevokedReviewedEffectCatalogEntry extends CatalogBase {
	readonly state: 'revoked';
	readonly revocation: Readonly<{
		release: string;
		reason: string;
	}>;
}

export type ReviewedEffectCatalogEntry =
	| ApprovedReviewedEffectCatalogEntry
	| RevokedReviewedEffectCatalogEntry;

type InternalCatalogRecord = Readonly<{
	descriptor: ReviewedEffectCatalogEntry;
	readBytes: (() => Uint8Array) | null;
}>;

const revokedUtilityGainManifest = defineReviewedEffectManifest({
	...UTILITY_GAIN_MANIFEST,
	version: '0.9.0',
});

const catalogRecords: readonly InternalCatalogRecord[] = Object.freeze([
	Object.freeze({
		descriptor: Object.freeze({
			catalogRelease: REVIEWED_EFFECT_CATALOG_RELEASE,
			manifest: UTILITY_GAIN_MANIFEST,
			sha256: UTILITY_GAIN_PACKAGE_SHA256,
			realtimeApproved: true,
			state: 'approved',
		}),
		readBytes: utilityGainPackageBytes,
	}),
	Object.freeze({
		descriptor: Object.freeze({
			catalogRelease: REVIEWED_EFFECT_CATALOG_RELEASE,
			manifest: revokedUtilityGainManifest,
			sha256: UTILITY_GAIN_PACKAGE_SHA256,
			realtimeApproved: false,
			state: 'revoked',
			revocation: Object.freeze({
				release: REVIEWED_EFFECT_CATALOG_RELEASE,
				reason: 'Pre-conformance package revision retired by the release catalog.',
			}),
		}),
		readBytes: null,
	}),
]);

const catalogByKey = new Map(catalogRecords.map((record) => [
	reviewedEffectPackageKey(record.descriptor.manifest),
	record,
]));

/** List immutable release metadata; callers cannot add trust or replace bytes. */
export function listReviewedEffectCatalog(): readonly ReviewedEffectCatalogEntry[] {
	return Object.freeze(catalogRecords.map(({ descriptor }) => descriptor));
}

/** Resolve one exact release-pinned package and fail closed on revocation. */
export function resolveReviewedEffectCatalogEntry(value: unknown): ApprovedReviewedEffectCatalogEntry {
	const reference = normalizeReviewedEffectPackageReference(value);
	const key = reviewedEffectPackageKey(reference);
	const record = catalogByKey.get(key);
	if (!record) {
		throw reviewedEffectError('PACKAGE_NOT_FOUND', `Reviewed effect package ${key} is not in this release catalog.`);
	}
	if (record.descriptor.state === 'revoked') {
		throw reviewedEffectError('PACKAGE_REVOKED', `Reviewed effect package ${key} is revoked.`);
	}
	return record.descriptor;
}

/** Read only the immutable artifact associated with an approved catalog key. */
export function readReleasePinnedReviewedEffectBytes(value: unknown): Uint8Array {
	const descriptor = resolveReviewedEffectCatalogEntry(value);
	const record = catalogByKey.get(reviewedEffectPackageKey(descriptor.manifest));
	if (!record?.readBytes) {
		throw reviewedEffectError('PACKAGE_NOT_FOUND', 'The reviewed effect artifact is unavailable.');
	}
	return record.readBytes();
}
