/* SPDX-License-Identifier: AGPL-3.0-only */

export const CATALOG_ORIGINAL_ROOT_STORE_NAME = 'catalogOriginalRoots';
export const CATALOG_ORIGINAL_ASSET_INDEX_NAME = 'assetId';
export const CATALOG_ORIGINAL_SCOPE_INDEX_NAME = 'scope';
export const MEDIA_ASSET_SHA256_INDEX_NAME = 'sha256';
export const CATALOG_ORIGINAL_PAGE_SIZE = 64;
export const CATALOG_ORIGINAL_BATCH_SIZE = 16;
export const CATALOG_ORIGINAL_ROOT_MAX_BYTES = 2 * 1024;
export const CATALOG_ORIGINAL_COUNT_FIELD = 'catalogRootCount';

export interface CatalogOriginalReferenceV1 {
	readonly photoId: string;
	/** Shared media record key, corresponding to PhotoOriginal.storageKey. */
	readonly assetId: string;
	/** Logical original source identity, distinct from its shared storage key. */
	readonly sourceId: string;
	readonly sha256: string;
	readonly size: number;
}

export interface CatalogOriginalRootV1 extends CatalogOriginalReferenceV1 {
	readonly schemaVersion: 1;
	readonly key: string;
	readonly catalogId: string;
	readonly importId: string | null;
	readonly scope: string;
	readonly mediaContentToken: string;
}

export function catalogOriginalId(value: unknown): string {
	if (typeof value !== 'string' || !value || value.length > 256 || value.trim() !== value) {
		throw new TypeError('A catalog original identity requires 1 to 256 non-padding characters.');
	}
	return value;
}

export function catalogOriginalScope(catalogId: string, importId: string | null): string {
	return JSON.stringify([catalogId, importId]);
}

export function catalogOriginalKey(catalogId: string, importId: string | null, photoId: string): string {
	return JSON.stringify([catalogId, importId, photoId]);
}

export function catalogOriginalReferences(input: unknown): readonly CatalogOriginalReferenceV1[] {
	return boundedArray(input).map((value) => {
		const fields = scalarRecord(value, ['photoId', 'assetId', 'sourceId', 'sha256', 'size']);
		if (typeof fields.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(fields.sha256)
			|| !Number.isSafeInteger(fields.size) || Number(fields.size) < 0) {
			throw new TypeError('A catalog original reference requires a SHA-256 digest and byte length.');
		}
		return Object.freeze({
			photoId: catalogOriginalId(fields.photoId), assetId: catalogOriginalId(fields.assetId),
			sourceId: catalogOriginalId(fields.sourceId), sha256: fields.sha256, size: Number(fields.size),
		});
	});
}

export function catalogOriginalPhotoIds(input: unknown): readonly string[] {
	const ids = boundedArray(input).map(catalogOriginalId);
	if (new Set(ids).size !== ids.length) throw new TypeError('Catalog original photo identities must be unique.');
	return ids;
}

export function normalizeCatalogOriginalRoot(input: unknown): Readonly<CatalogOriginalRootV1> {
	const fields = scalarRecord(input, [
		'photoId', 'assetId', 'sourceId', 'sha256', 'size', 'schemaVersion', 'key', 'catalogId',
		'importId', 'scope', 'mediaContentToken',
	]);
	const [reference] = catalogOriginalReferences([{
		photoId: fields.photoId, assetId: fields.assetId, sourceId: fields.sourceId,
		sha256: fields.sha256, size: fields.size,
	}]);
	if (!reference) throw new TypeError('A catalog original root requires its media reference.');
	const catalogId = catalogOriginalId(fields.catalogId);
	const importId = fields.importId === null ? null : catalogOriginalId(fields.importId);
	if (fields.schemaVersion !== 1 || typeof fields.mediaContentToken !== 'string'
		|| !/^media-content-[a-z0-9][a-z0-9-]{15,127}$/.test(fields.mediaContentToken)
		|| fields.scope !== catalogOriginalScope(catalogId, importId)
		|| fields.key !== catalogOriginalKey(catalogId, importId, reference.photoId)) {
		throw new TypeError('Unsupported or malformed catalog original root identity.');
	}
	const normalized = Object.freeze({
		...reference, schemaVersion: 1 as const, key: String(fields.key), catalogId, importId,
		scope: String(fields.scope), mediaContentToken: fields.mediaContentToken,
	});
	if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > CATALOG_ORIGINAL_ROOT_MAX_BYTES) {
		throw new RangeError('A catalog original root exceeds 2 KiB.');
	}
	return normalized;
}

function scalarRecord(input: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
		throw new TypeError('A plain catalog original reference record is required.');
	}
	const descriptors = Object.getOwnPropertyDescriptors(input);
	if (Reflect.ownKeys(input).length !== keys.length) {
		throw new TypeError('Catalog original record fields must be closed scalar data properties.');
	}
	return Object.fromEntries(keys.map((key) => {
		const descriptor = descriptors[key];
		if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
			throw new TypeError('Catalog original record fields must be closed scalar data properties.');
		}
		return [key, descriptor.value];
	}));
}

function boundedArray(input: unknown): readonly unknown[] {
	if (!Array.isArray(input) || input.length > CATALOG_ORIGINAL_BATCH_SIZE) {
		throw new RangeError('A catalog original transaction admits at most 16 photo roots.');
	}
	const descriptors = Object.getOwnPropertyDescriptors(input);
	if (Reflect.ownKeys(input).length !== input.length + 1) throw new TypeError('Sparse or extended root arrays are refused.');
	return Array.from({ length: input.length }, (_, index) => {
		const descriptor = descriptors[String(index)];
		if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
			throw new TypeError('Catalog root arrays require data entries.');
		}
		return descriptor.value as unknown;
	});
}
