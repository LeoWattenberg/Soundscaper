/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeVideoTimingAssetReference,
	type VideoTimingAssetReference,
} from './video-timing-asset-reference.ts';

export const VIDEO_PROXY_MAXIMUM_BODY_BYTES = 512 * 1024 * 1024;

export interface VideoProxyAttachmentV18 {
	readonly kind: 'video-proxy-attachment';
	readonly version: 1;
	readonly rule: 'exact-original-generation-proxy-content-and-timing-v1';
	readonly storageKey: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly originalSha256: string;
	readonly originalAuthorityKind: 'owned' | 'linked';
	readonly generatorId: string;
	readonly generatorVersion: number;
	readonly recipeId: string;
	readonly recipeVersion: number;
	readonly timingBackendId: string;
	readonly timingRule: 'exact-presentation-boundaries-v1';
	readonly frameCount: number;
	readonly boundaryCount: number;
	readonly timingAsset: VideoTimingAssetReference;
	readonly audioPolicy: 'ignore-proxy-container-audio-v1';
}

const ATTACHMENT_FIELDS = [
	'kind', 'version', 'rule', 'storageKey', 'mimeType', 'byteLength', 'sha256',
	'originalSha256', 'originalAuthorityKind', 'generatorId', 'generatorVersion',
	'recipeId', 'recipeVersion', 'timingBackendId', 'timingRule', 'frameCount',
	'boundaryCount', 'timingAsset', 'audioPolicy',
] as const;
const TIMING_FIELDS = [
	'encoding', 'storageKey', 'sha256', 'sourceSha256', 'byteLength', 'frameCount',
	'timescale', 'finalFrameDurationTicks',
] as const;
const SHA256 = /^[a-f0-9]{64}$/u;
const VIDEO_MIME_TYPE = /^video\/[a-z0-9][a-z0-9!#$&^_.+\-]*$/u;
const PRINTABLE_ASCII = /^[\x20-\x7e]{1,128}$/u;
const PROXY_STORAGE_PREFIX = 'video-proxy-sha256:';

export function normalizeVideoProxyAttachmentV18(
	value: unknown,
): Readonly<VideoProxyAttachmentV18> {
	const attachment = snapshotClosedRecord(
		value,
		ATTACHMENT_FIELDS,
		'video proxy attachment',
	);
	const timingSnapshot = snapshotClosedRecord(
		attachment.timingAsset,
		TIMING_FIELDS,
		'video proxy attachment timing asset',
	);
	const timingAsset = normalizeVideoTimingAssetReference(timingSnapshot);

	const kind = exactLiteral(
		attachment.kind,
		'video-proxy-attachment',
		'video proxy attachment kind',
	);
	const version = exactLiteral(attachment.version, 1, 'video proxy attachment version');
	const rule = exactLiteral(
		attachment.rule,
		'exact-original-generation-proxy-content-and-timing-v1',
		'video proxy attachment rule',
	);
	const sha256 = digest(attachment.sha256, 'video proxy attachment');
	const storageKey = proxyStorageKey(attachment.storageKey, sha256);
	const mimeType = videoMimeType(attachment.mimeType);
	const byteLength = positiveSafeInteger(attachment.byteLength, 'video proxy attachment byteLength');
	if (byteLength > VIDEO_PROXY_MAXIMUM_BODY_BYTES) {
		throw new RangeError('The video proxy attachment exceeds its maximum body byte length.');
	}
	const originalSha256 = digest(attachment.originalSha256, 'video proxy original');
	const originalAuthorityKind = originalAuthority(attachment.originalAuthorityKind);
	const generatorId = boundedIdentifier(attachment.generatorId, 'video proxy generator ID');
	const generatorVersion = positiveSafeInteger(
		attachment.generatorVersion,
		'video proxy generator version',
	);
	const recipeId = boundedIdentifier(attachment.recipeId, 'video proxy recipe ID');
	const recipeVersion = positiveSafeInteger(
		attachment.recipeVersion,
		'video proxy recipe version',
	);
	const timingBackendId = boundedIdentifier(
		attachment.timingBackendId,
		'video proxy timing backend ID',
	);
	const timingRule = exactLiteral(
		attachment.timingRule,
		'exact-presentation-boundaries-v1',
		'video proxy attachment timing rule',
	);
	const frameCount = positiveSafeInteger(attachment.frameCount, 'video proxy attachment frameCount');
	const boundaryCount = positiveSafeInteger(
		attachment.boundaryCount,
		'video proxy attachment boundaryCount',
	);
	assertBoundaryCount(frameCount, boundaryCount);
	const audioPolicy = exactLiteral(
		attachment.audioPolicy,
		'ignore-proxy-container-audio-v1',
		'video proxy attachment audio policy',
	);
	if (timingAsset.sourceSha256 !== sha256) {
		throw new RangeError('The video proxy attachment timing source digest does not match its proxy digest.');
	}
	if (timingAsset.frameCount !== frameCount) {
		throw new RangeError('The video proxy attachment timing frame count does not match its frame count.');
	}

	return Object.freeze({
		kind,
		version,
		rule,
		storageKey,
		mimeType,
		byteLength,
		sha256,
		originalSha256,
		originalAuthorityKind,
		generatorId,
		generatorVersion,
		recipeId,
		recipeVersion,
		timingBackendId,
		timingRule,
		frameCount,
		boundaryCount,
		timingAsset,
		audioPolicy,
	});
}

function snapshotClosedRecord(
	value: unknown,
	fields: readonly string[],
	name: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} has unsupported, missing, or extra fields.`);
	}
	const snapshot = Object.create(null) as Record<string, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an own enumerable data property, not an accessor.`);
		}
		snapshot[field] = descriptor.value;
	}
	return Object.freeze(snapshot);
}

function exactLiteral<const Value extends string | number>(
	value: unknown,
	expected: Value,
	name: string,
): Value {
	if (value !== expected) throw new RangeError(`${name} is unsupported.`);
	return expected;
}

function proxyStorageKey(value: unknown, sha256: string): string {
	const expected = `${PROXY_STORAGE_PREFIX}${sha256}`;
	if (value !== expected) {
		throw new TypeError('The video proxy attachment storage key does not match its digest.');
	}
	return expected;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError(`${name} must have a lowercase SHA-256 digest.`);
	}
	return value;
}

function videoMimeType(value: unknown): string {
	if (typeof value !== 'string' || value.length > 128 || !VIDEO_MIME_TYPE.test(value)) {
		throw new TypeError('The video proxy attachment MIME type is invalid.');
	}
	return value;
}

function originalAuthority(value: unknown): 'owned' | 'linked' {
	if (value !== 'owned' && value !== 'linked') {
		throw new RangeError('The video proxy original authority kind is unsupported.');
	}
	return value;
}

function boundedIdentifier(value: unknown, name: string): string {
	if (typeof value !== 'string' || !PRINTABLE_ASCII.test(value) || value.trim() !== value
		|| value.includes('/') || value.includes('\\')) {
		throw new TypeError(`${name} must be a printable pathless identifier of at most 128 characters.`);
	}
	return value;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

function assertBoundaryCount(frameCount: number, boundaryCount: number): void {
	const expected = BigInt(frameCount) + 1n;
	if (expected > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(boundaryCount) !== expected) {
		throw new RangeError('The video proxy attachment boundary count must equal its frame count plus one.');
	}
}
