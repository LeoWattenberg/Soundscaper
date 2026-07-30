/* SPDX-License-Identifier: AGPL-3.0-only */

import { awaitScapeReadOperation, throwIfScapeAborted } from './scape-abort.ts';

export const SCAPE_IMPORT_QUOTA_ERROR_CODE = 'QUOTA_EXCEEDED' as const;

export interface ScapeImportCapacityManifest {
	readonly assets: readonly Readonly<{ size: number }>[];
}

export interface ScapeImportCapacityRequirement {
	readonly assetBytes: number;
	readonly headroomBytes: number;
	readonly requiredFreeBytes: number;
}

export interface ScapeImportQuotaErrorDetails extends ScapeImportCapacityRequirement {
	readonly usage: number;
	readonly quota: number;
	readonly availableBytes: number;
}

export interface ScapeImportCapacityOptions {
	readonly estimateStorage?: (() => PromiseLike<unknown> | unknown) | null;
	readonly estimateStorageForPreflight?: ((
		assetBytes: number,
		operation: 'import',
	) => PromiseLike<unknown> | unknown) | null;
	readonly signal?: AbortSignal;
}

export class ScapeImportQuotaError extends Error {
	readonly code = SCAPE_IMPORT_QUOTA_ERROR_CODE;
	readonly details: Readonly<ScapeImportQuotaErrorDetails>;

	constructor(details: ScapeImportQuotaErrorDetails) {
		super('There is not enough storage available to import this .scape project.');
		this.name = 'ScapeImportQuotaError';
		this.details = Object.freeze({ ...details });
	}
}

/** Checked aggregate asset bytes plus the fixed ten-percent import headroom. */
export function scapeImportCapacityRequirement(
	manifest: ScapeImportCapacityManifest,
): Readonly<ScapeImportCapacityRequirement> {
	if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.assets)) {
		throw new TypeError('A .scape manifest with an asset list is required for import capacity admission.');
	}
	let assetBytes = 0;
	for (const asset of manifest.assets) {
		const size = asset?.size;
		if (!Number.isSafeInteger(size) || size < 0) {
			throw new RangeError('A .scape manifest asset size must be a safe non-negative integer.');
		}
		if (size > Number.MAX_SAFE_INTEGER - assetBytes) {
			throw new RangeError('The .scape import asset-byte total exceeds the supported safe integer range.');
		}
		assetBytes += size;
	}
	const headroomBytes = Math.floor(assetBytes / 10) + (assetBytes % 10 === 0 ? 0 : 1);
	if (assetBytes > Number.MAX_SAFE_INTEGER - headroomBytes) {
		throw new RangeError('The .scape import required free bytes exceed the supported safe integer range.');
	}
	return Object.freeze({
		assetBytes,
		headroomBytes,
		requiredFreeBytes: assetBytes + headroomBytes,
	});
}

/** Optionally refuses a known-insufficient estimate; unavailable estimates remain advisory. */
export async function preflightScapeImportCapacity(
	manifest: ScapeImportCapacityManifest,
	options: ScapeImportCapacityOptions = {},
): Promise<Readonly<ScapeImportCapacityRequirement>> {
	const requirement = scapeImportCapacityRequirement(manifest);
	const estimateStorage = options.estimateStorage;
	const estimateStorageForPreflight = options.estimateStorageForPreflight;
	if (estimateStorage != null && typeof estimateStorage !== 'function') {
		throw new TypeError('The .scape import storage estimator must be a function.');
	}
	if (estimateStorageForPreflight != null && typeof estimateStorageForPreflight !== 'function') {
		throw new TypeError('The .scape import preflight storage estimator must be a function.');
	}
	const estimate = await awaitScapeReadOperation(
		() => estimateStorageForPreflight
			? estimateStorageForPreflight(requirement.assetBytes, 'import')
			: estimateStorage ? estimateStorage() : null,
		options.signal,
	);
	throwIfScapeAborted(options.signal);
	const known = knownStorageEstimate(estimate);
	if (!known) return requirement;
	const availableBytes = Math.max(0, known.quota - known.usage);
	if (availableBytes >= requirement.requiredFreeBytes) return requirement;
	throw new ScapeImportQuotaError({
		...requirement,
		usage: known.usage,
		quota: known.quota,
		availableBytes,
	});
}

function knownStorageEstimate(value: unknown): Readonly<{ usage: number; quota: number }> | null {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as Readonly<{ usage?: unknown; quota?: unknown }>;
	if (!isKnownByteEstimate(candidate.usage) || !isKnownByteEstimate(candidate.quota)) return null;
	return { usage: candidate.usage, quota: candidate.quota };
}

function isKnownByteEstimate(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
