/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeVideoTimingAssetReference,
	VIDEO_TIMING_ASSET_ENCODING,
	VIDEO_TIMING_ASSET_MIME_TYPE,
	type VideoTimingAssetReference,
} from './video-timing-asset-reference.ts';

export interface ScapeVideoProxyArchiveReference {
	readonly storageKey: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly timingAsset: VideoTimingAssetReference;
}

export interface ScapeVideoProxyArchiveAssetDescriptor {
	readonly sourceId: string;
	readonly kind: 'video-proxy' | 'video-timing';
	readonly encoding: 'video-proxy-v1' | typeof VIDEO_TIMING_ASSET_ENCODING;
	readonly entry: string;
	readonly mimeType: string;
	readonly size: number;
	readonly sha256: string;
}

const REFERENCE_FIELDS = [
	'storageKey', 'mimeType', 'byteLength', 'sha256', 'timingAsset',
] as const;
const TIMING_FIELDS = [
	'encoding', 'storageKey', 'sha256', 'sourceSha256', 'byteLength', 'frameCount',
	'timescale', 'finalFrameDurationTicks',
] as const;
const SHA256 = /^[a-f0-9]{64}$/u;
const VIDEO_MIME_TYPE = /^video\/[a-z0-9][a-z0-9!#$&^_.+\-]*$/u;
const PROXY_STORAGE_PREFIX = 'video-proxy-sha256:';
const MAXIMUM_PROXY_BYTES = 512 * 1024 * 1024;
const MAXIMUM_ASSETS = 4_094;

/**
 * Builds detached proxy and timing metadata for the unified format-1 archive.
 * Body ownership remains with the caller's Scape asset extension.
 */
export function planScapeVideoProxyArchiveAssets(
	value: unknown,
): Readonly<{
	readonly formatVersion: 1;
	readonly assets: readonly Readonly<ScapeVideoProxyArchiveAssetDescriptor>[];
}> {
	const references = snapshotDenseArray(value);
	const assets: Readonly<ScapeVideoProxyArchiveAssetDescriptor>[] = [];
	const assetBySourceId = new Map<string, Readonly<ScapeVideoProxyArchiveAssetDescriptor>>();
	const assetByEntry = new Map<string, Readonly<ScapeVideoProxyArchiveAssetDescriptor>>();
	const timingByStorageKey = new Map<string, Readonly<VideoTimingAssetReference>>();

	for (const candidate of references) {
		if (candidate === null) continue;
		const reference = normalizeReference(candidate);
		addAsset(proxyDescriptor(reference), assets, assetBySourceId, assetByEntry);

		const priorTiming = timingByStorageKey.get(reference.timingAsset.storageKey);
		if (priorTiming && !sameTimingBody(priorTiming, reference.timingAsset)) {
			throw new Error(
				`Video proxy timing asset ${reference.timingAsset.storageKey} has conflicting references.`,
			);
		}
		if (!priorTiming) timingByStorageKey.set(reference.timingAsset.storageKey, reference.timingAsset);
		addAsset(timingDescriptor(reference.timingAsset), assets, assetBySourceId, assetByEntry);
	}

	return Object.freeze({
		formatVersion: 1,
		assets: Object.freeze(assets),
	});
}

function normalizeReference(value: unknown): Readonly<ScapeVideoProxyArchiveReference> {
	const raw = snapshotClosedRecord(value, REFERENCE_FIELDS, 'video proxy archive reference');
	const timingRaw = snapshotClosedRecord(
		raw.timingAsset,
		TIMING_FIELDS,
		'video proxy archive timing reference',
	);
	const timingAsset = normalizeVideoTimingAssetReference(timingRaw);
	const sha256 = digest(raw.sha256, 'video proxy archive body');
	const storageKey = `${PROXY_STORAGE_PREFIX}${sha256}`;
	if (raw.storageKey !== storageKey) {
		throw new TypeError('The video proxy archive storage key does not match its digest.');
	}
	const mimeType = videoMimeType(raw.mimeType);
	const byteLength = positiveSafeInteger(raw.byteLength, 'video proxy archive byteLength');
	if (byteLength > MAXIMUM_PROXY_BYTES) {
		throw new RangeError('The video proxy archive body exceeds its maximum byte length.');
	}
	if (timingAsset.sourceSha256 !== sha256) {
		throw new Error('The video proxy archive timing reference is not bound to its proxy digest.');
	}
	return Object.freeze({ storageKey, mimeType, byteLength, sha256, timingAsset });
}

function proxyDescriptor(
	reference: Readonly<ScapeVideoProxyArchiveReference>,
): Readonly<ScapeVideoProxyArchiveAssetDescriptor> {
	return Object.freeze({
		sourceId: reference.storageKey,
		kind: 'video-proxy',
		encoding: 'video-proxy-v1',
		entry: `proxy/${reference.sha256}/body`,
		mimeType: reference.mimeType,
		size: reference.byteLength,
		sha256: reference.sha256,
	});
}

function timingDescriptor(
	reference: Readonly<VideoTimingAssetReference>,
): Readonly<ScapeVideoProxyArchiveAssetDescriptor> {
	return Object.freeze({
		sourceId: reference.storageKey,
		kind: 'video-timing',
		encoding: VIDEO_TIMING_ASSET_ENCODING,
		entry: `timing/${reference.sha256}.scti`,
		mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
		size: reference.byteLength,
		sha256: reference.sha256,
	});
}

function addAsset(
	asset: Readonly<ScapeVideoProxyArchiveAssetDescriptor>,
	assets: Readonly<ScapeVideoProxyArchiveAssetDescriptor>[],
	assetBySourceId: Map<string, Readonly<ScapeVideoProxyArchiveAssetDescriptor>>,
	assetByEntry: Map<string, Readonly<ScapeVideoProxyArchiveAssetDescriptor>>,
): void {
	const priorSource = assetBySourceId.get(asset.sourceId);
	const priorEntry = assetByEntry.get(asset.entry);
	if (priorSource || priorEntry) {
		if (priorSource && priorEntry && priorSource === priorEntry && sameAsset(priorSource, asset)) return;
		throw new Error(`Scape format-1 asset ${asset.sourceId} has a conflicting identity.`);
	}
	if (assets.length >= MAXIMUM_ASSETS) {
		throw new RangeError('The Scape format-1 archive contains too many assets.');
	}
	assets.push(asset);
	assetBySourceId.set(asset.sourceId, asset);
	assetByEntry.set(asset.entry, asset);
}

function sameAsset(
	left: Readonly<ScapeVideoProxyArchiveAssetDescriptor>,
	right: Readonly<ScapeVideoProxyArchiveAssetDescriptor>,
): boolean {
	return left.sourceId === right.sourceId
		&& left.kind === right.kind
		&& left.encoding === right.encoding
		&& left.entry === right.entry
		&& left.mimeType === right.mimeType
		&& left.size === right.size
		&& left.sha256 === right.sha256;
}

function sameTimingBody(
	left: Readonly<VideoTimingAssetReference>,
	right: Readonly<VideoTimingAssetReference>,
): boolean {
	return left.encoding === right.encoding
		&& left.storageKey === right.storageKey
		&& left.sha256 === right.sha256
		&& left.byteLength === right.byteLength
		&& left.frameCount === right.frameCount
		&& left.timescale === right.timescale
		&& left.finalFrameDurationTicks === right.finalFrameDurationTicks;
}

function snapshotDenseArray(value: unknown): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError('Video proxy archive references must be a plain dense array.');
	}
	const keys = Reflect.ownKeys(value);
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
	if (!lengthDescriptor || lengthDescriptor.enumerable || !Object.hasOwn(lengthDescriptor, 'value')) {
		throw new TypeError('Video proxy archive references must have a canonical length.');
	}
	const length = lengthDescriptor.value;
	if (!Number.isSafeInteger(length) || Number(length) < 0 || Number(length) > MAXIMUM_ASSETS) {
		throw new RangeError('Video proxy archive references have an invalid length.');
	}
	const size = Number(length);
	const expected = new Set<PropertyKey>(['length']);
	for (let index = 0; index < size; index += 1) expected.add(String(index));
	if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
		throw new TypeError('Video proxy archive references must be dense and have no extra keys.');
	}
	const snapshot: unknown[] = [];
	for (let index = 0; index < size; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError('Video proxy archive references must contain enumerable data elements.');
		}
		snapshot.push(descriptor.value);
	}
	return snapshot;
}

function snapshotClosedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	name: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) throw new TypeError(`${name} has invalid fields.`);
	const snapshot = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} ${field} must be an own enumerable data property.`);
		}
		snapshot[field] = descriptor.value;
	}
	return snapshot;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError(`${name} must have a lowercase SHA-256 digest.`);
	}
	return value;
}

function videoMimeType(value: unknown): string {
	if (typeof value !== 'string' || value.length > 128 || !VIDEO_MIME_TYPE.test(value)) {
		throw new TypeError('The video proxy archive MIME type is invalid.');
	}
	return value;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}
