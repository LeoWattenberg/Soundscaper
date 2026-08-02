/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	isMediaContentSha256,
	isMediaContentToken,
	trustedMediaContentSha256,
} from './media-content-provenance.ts';
import {
	normalizeLinkedVideoOriginalBinding,
	type LinkedVideoOriginalBinding,
} from './linked-video-original-binding.ts';
import type { StorageRecord } from './media-records.ts';

export const VIDEO_DERIVATIVE_BINDING_VERSION = 1;

export interface VideoDerivativeRecipe {
	readonly id: string;
	readonly version: number;
}

export type VideoDerivativeType = 'poster' | 'thumbnail';

export const VIDEO_DERIVATIVE_RECIPES: Readonly<Record<
	VideoDerivativeType,
	Readonly<VideoDerivativeRecipe>
>> = Object.freeze({
	poster: Object.freeze({
		id: 'soundscaper.video-preview.poster',
		version: 1,
	}),
	thumbnail: Object.freeze({
		id: 'soundscaper.video-preview.thumbnail',
		version: 1,
	}),
});

export interface VideoDerivativeIdentity {
	readonly key: string;
	readonly sourceId: string;
	readonly timestamp: number;
	readonly type: VideoDerivativeType;
	readonly derivativeBindingVersion: typeof VIDEO_DERIVATIVE_BINDING_VERSION;
	readonly originalSha256: string;
	readonly recipeId: string;
	readonly recipeVersion: number;
}

export interface VerifiedVideoDerivativeOriginal {
	readonly sha256: string;
	readonly mediaContentToken: string;
}

/** Exact disposable-preview provenance derived from one current linked binding. */
export function linkedVideoDerivativeOriginal(
	value: LinkedVideoOriginalBinding,
): Readonly<VerifiedVideoDerivativeOriginal> {
	const binding = normalizeLinkedVideoOriginalBinding(value);
	const tokenDigest = bytesToHex(sha256(TEXT_ENCODER.encode(JSON.stringify([
		'linked-video-derivative-original',
		1,
		binding,
	]))));
	return Object.freeze({
		sha256: binding.sha256,
		mediaContentToken: `media-content-${tokenDigest}`,
	});
}

export function normalizeVerifiedVideoDerivativeOriginal(
	value: VerifiedVideoDerivativeOriginal,
): Readonly<VerifiedVideoDerivativeOriginal> {
	if (!value || !isMediaContentSha256(value.sha256) || !isMediaContentToken(value.mediaContentToken)) {
		throw new TypeError('Verified video derivative original provenance is required.');
	}
	return Object.freeze({ sha256: value.sha256, mediaContentToken: value.mediaContentToken });
}

const KEY_PREFIX = 'video-derivative-sha256:';
const MAXIMUM_RECIPE_ID_CHARACTERS = 128;
const TEXT_ENCODER = new TextEncoder();

/**
 * Binds one disposable derivative to exact retained-original content and the
 * maintained recipe that can reproduce it. The opaque key keeps source names
 * and recipe details out of IndexedDB and OPFS identifiers.
 */
export function videoDerivativeIdentity(
	storageKey: unknown,
	trustedOriginalSha256: unknown,
	timestamp: unknown,
	type: unknown,
	recipe?: VideoDerivativeRecipe,
): Readonly<VideoDerivativeIdentity> {
	const sourceId = nonEmptyString(storageKey, 'An original media storage key is required.');
	if (!isMediaContentSha256(trustedOriginalSha256)) {
		throw new TypeError('A verified original media lowercase SHA-256 digest is required.');
	}
	const derivativeType = videoDerivativeType(type);
	const sourceTimestamp = nonNegativeFiniteNumber(timestamp);
	const normalizedRecipe = normalizeVideoDerivativeRecipe(recipe ?? VIDEO_DERIVATIVE_RECIPES[derivativeType]);
	const descriptor = [
		'video-derivative-binding',
		VIDEO_DERIVATIVE_BINDING_VERSION,
		['original', sourceId, trustedOriginalSha256],
		['derivative', derivativeType, sourceTimestamp],
		['recipe', normalizedRecipe.id, normalizedRecipe.version],
	] as const;
	const digest = bytesToHex(sha256(TEXT_ENCODER.encode(JSON.stringify(descriptor))));
	return Object.freeze({
		key: `${KEY_PREFIX}${digest}`,
		sourceId,
		timestamp: sourceTimestamp,
		type: derivativeType,
		derivativeBindingVersion: VIDEO_DERIVATIVE_BINDING_VERSION,
		originalSha256: trustedOriginalSha256,
		recipeId: normalizedRecipe.id,
		recipeVersion: normalizedRecipe.version,
	});
}

export function verifiedVideoDerivativeOriginal(
	record: StorageRecord | null,
	sourceId: string,
): VerifiedVideoDerivativeOriginal {
	const binding = optionalVerifiedVideoDerivativeOriginal(record, sourceId);
	if (!binding) throw new Error(`Verified original media ${sourceId} is missing or untrusted.`);
	return binding;
}

export function optionalVerifiedVideoDerivativeOriginal(
	record: StorageRecord | null,
	sourceId: string,
): VerifiedVideoDerivativeOriginal | null {
	const digest = record?.sourceId === sourceId ? trustedMediaContentSha256(record) : null;
	return digest && typeof record?.mediaContentToken === 'string'
		? Object.freeze({ sha256: digest, mediaContentToken: record.mediaContentToken })
		: null;
}

export function assertVideoDerivativeOriginalUnchanged(
	record: StorageRecord | null,
	sourceId: string,
	expected: VerifiedVideoDerivativeOriginal,
): void {
	const current = optionalVerifiedVideoDerivativeOriginal(record, sourceId);
	if (!current || current.sha256 !== expected.sha256
		|| current.mediaContentToken !== expected.mediaContentToken) {
		throw new Error(`Verified original media ${sourceId} changed during derivative publication.`);
	}
}

export function assertVideoDerivativeRecordBinding(
	record: StorageRecord,
	identity: Readonly<VideoDerivativeIdentity>,
	original: VerifiedVideoDerivativeOriginal,
): void {
	if (record.key !== identity.key || record.sourceId !== identity.sourceId
		|| record.timestamp !== identity.timestamp || record.type !== identity.type
		|| record.derivativeBindingVersion !== identity.derivativeBindingVersion
		|| record.originalSha256 !== identity.originalSha256
		|| record.originalMediaContentToken !== original.mediaContentToken
		|| record.recipeId !== identity.recipeId || record.recipeVersion !== identity.recipeVersion
		|| !isMediaContentSha256(record.outputSha256)) {
		throw new Error('The requested local video derivative failed its binding integrity check.');
	}
}

export function matchesVideoDerivativeRecordBinding(
	record: StorageRecord,
	sourceId: string,
	original: VerifiedVideoDerivativeOriginal,
	recipe?: VideoDerivativeRecipe,
): boolean {
	try {
		const identity = videoDerivativeIdentity(
			sourceId, original.sha256, record.timestamp, record.type, recipe,
		);
		assertVideoDerivativeRecordBinding(record, identity, original);
		return true;
	} catch {
		return false;
	}
}

function videoDerivativeType(value: unknown): VideoDerivativeType {
	if (value !== 'poster' && value !== 'thumbnail') {
		throw new TypeError('A video derivative type of poster or thumbnail is required.');
	}
	return value;
}

export function normalizeVideoDerivativeRecipe(value: unknown): Readonly<VideoDerivativeRecipe> {
	if (!value || typeof value !== 'object') {
		throw new TypeError('A video derivative recipe is required.');
	}
	const candidate = value as Partial<VideoDerivativeRecipe>;
	const id = nonEmptyString(candidate.id, 'A video derivative recipe id is required.');
	if (id.length > MAXIMUM_RECIPE_ID_CHARACTERS) {
		throw new RangeError(
			`A video derivative recipe id cannot exceed ${MAXIMUM_RECIPE_ID_CHARACTERS} characters.`,
		);
	}
	if (!Number.isSafeInteger(candidate.version) || Number(candidate.version) < 1) {
		throw new RangeError('A video derivative recipe version must be a positive safe integer.');
	}
	return Object.freeze({ id, version: Number(candidate.version) });
}

function nonNegativeFiniteNumber(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new RangeError('A non-negative derivative timestamp is required.');
	}
	return Object.is(value, -0) ? 0 : value;
}

function nonEmptyString(value: unknown, message: string): string {
	const text = typeof value === 'string' ? value.trim() : '';
	if (!text) throw new TypeError(message);
	return text;
}
