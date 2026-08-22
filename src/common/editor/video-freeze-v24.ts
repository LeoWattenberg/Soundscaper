/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';

export interface VideoFreezeFreshnessInputV1 {
	readonly authoredStateSha256: string;
	readonly inputIdentitiesSha256: string;
	readonly renderPlanFingerprintSha256: string;
	readonly nativeEffectFingerprintSha256: string;
}

export interface VideoFreezeFreshnessV1 extends VideoFreezeFreshnessInputV1 {
	readonly freshnessSha256: string;
}

export interface VideoFreezeFallbackCreateV1 extends VideoFreezeFreshnessInputV1 {
	readonly renderedSourceId: string;
	readonly renderedAssetSha256: string;
}

export interface VideoFreezeFallbackV1 extends VideoFreezeFallbackCreateV1 {
	readonly schemaVersion: 1;
	readonly freshnessSha256: string;
}

export type VideoFreezeChangedComponentV1 =
	| 'authored-state'
	| 'input-identities'
	| 'render-plan'
	| 'native-effect';

export interface VideoFreezeFallbackDispositionV1 {
	readonly status: 'fresh' | 'stale' | 'unverifiable';
	readonly mode: 'frozen' | 'bypass';
	readonly changedComponents: readonly VideoFreezeChangedComponentV1[];
	readonly authoredStatePreserved: true;
	readonly reportsDegradation: boolean;
}

const FRESHNESS_INPUT_FIELDS = Object.freeze([
	'authoredStateSha256',
	'inputIdentitiesSha256',
	'renderPlanFingerprintSha256',
	'nativeEffectFingerprintSha256',
]);
const CREATE_FIELDS = Object.freeze([
	'renderedSourceId',
	'renderedAssetSha256',
	...FRESHNESS_INPUT_FIELDS,
]);
const FALLBACK_FIELDS = Object.freeze([
	'schemaVersion',
	...CREATE_FIELDS,
	'freshnessSha256',
]);
const SHA256 = /^[a-f0-9]{64}$/u;
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const TEXT_ENCODER = new TextEncoder();

/** Bind the exact four inputs that determine whether frozen video is truthful. */
export function computeVideoFreezeFreshnessV1(value: unknown): VideoFreezeFreshnessV1 {
	const input = normalizeFreshnessInput(value, 'video freeze freshness input');
	return Object.freeze({
		...input,
		freshnessSha256: hashCanonical([
			'soundscaper.video-freeze.freshness/v1',
			input.authoredStateSha256,
			input.inputIdentitiesSha256,
			input.renderPlanFingerprintSha256,
			input.nativeEffectFingerprintSha256,
		]),
	});
}

/** Create a reference to external fallback media; rendered bytes never enter this record. */
export function createVideoFreezeFallbackV1(value: unknown): VideoFreezeFallbackV1 {
	const record = readClosedDomainRecord(value, 'video freeze fallback input', CREATE_FIELDS);
	const freshness = computeVideoFreezeFreshnessV1(freshnessFields(record, 'video freeze fallback input'));
	return Object.freeze({
		schemaVersion: 1 as const,
		renderedSourceId: stableId(field(record, 'renderedSourceId', 'video freeze fallback input'), 'video freeze fallback rendered source'),
		renderedAssetSha256: digest(field(record, 'renderedAssetSha256', 'video freeze fallback input'), 'video freeze fallback asset'),
		...freshness,
	});
}

/** Validate persisted fallback identity and reject freshness tampering. */
export function normalizeVideoFreezeFallbackV1(value: unknown): VideoFreezeFallbackV1 {
	const record = readClosedDomainRecord(value, 'video freeze fallback', FALLBACK_FIELDS);
	if (field(record, 'schemaVersion', 'video freeze fallback') !== 1) {
		throw new RangeError('video freeze fallback.schemaVersion must be 1.');
	}
	const freshness = computeVideoFreezeFreshnessV1(freshnessFields(record, 'video freeze fallback'));
	const suppliedFreshness = digest(field(record, 'freshnessSha256', 'video freeze fallback'), 'video freeze fallback freshness');
	if (suppliedFreshness !== freshness.freshnessSha256) {
		throw new RangeError('The video freeze fallback freshness digest does not match its bound components.');
	}
	return Object.freeze({
		schemaVersion: 1 as const,
		renderedSourceId: stableId(field(record, 'renderedSourceId', 'video freeze fallback'), 'video freeze fallback rendered source'),
		renderedAssetSha256: digest(field(record, 'renderedAssetSha256', 'video freeze fallback'), 'video freeze fallback asset'),
		...freshness,
	});
}

/**
 * A stale or unverifiable fallback is never render authority. The caller keeps
 * authored effect state and can only bypass while reporting degradation.
 */
export function classifyVideoFreezeFallbackV1(
	fallbackValue: unknown,
	currentValue: unknown,
): VideoFreezeFallbackDispositionV1 {
	const fallback = normalizeVideoFreezeFallbackV1(fallbackValue);
	let current: VideoFreezeFreshnessV1;
	try {
		current = computeVideoFreezeFreshnessV1(currentValue);
	} catch {
		return disposition('unverifiable', 'bypass', [], true);
	}
	const changed: VideoFreezeChangedComponentV1[] = [];
	if (fallback.authoredStateSha256 !== current.authoredStateSha256) changed.push('authored-state');
	if (fallback.inputIdentitiesSha256 !== current.inputIdentitiesSha256) changed.push('input-identities');
	if (fallback.renderPlanFingerprintSha256 !== current.renderPlanFingerprintSha256) changed.push('render-plan');
	if (fallback.nativeEffectFingerprintSha256 !== current.nativeEffectFingerprintSha256) changed.push('native-effect');
	if (changed.length > 0 || fallback.freshnessSha256 !== current.freshnessSha256) {
		return disposition('stale', 'bypass', changed, true);
	}
	return disposition('fresh', 'frozen', [], false);
}

function normalizeFreshnessInput(value: unknown, name: string): VideoFreezeFreshnessInputV1 {
	const record = readClosedDomainRecord(value, name, FRESHNESS_INPUT_FIELDS);
	return Object.freeze({
		authoredStateSha256: digest(field(record, 'authoredStateSha256', name), `${name} authored state`),
		inputIdentitiesSha256: digest(field(record, 'inputIdentitiesSha256', name), `${name} input identities`),
		renderPlanFingerprintSha256: digest(field(record, 'renderPlanFingerprintSha256', name), `${name} render plan fingerprint`),
		nativeEffectFingerprintSha256: digest(field(record, 'nativeEffectFingerprintSha256', name), `${name} native effect fingerprint`),
	});
}

function freshnessFields(record: ClosedDomainRecord, name: string): VideoFreezeFreshnessInputV1 {
	return Object.freeze({
		authoredStateSha256: field(record, 'authoredStateSha256', name),
		inputIdentitiesSha256: field(record, 'inputIdentitiesSha256', name),
		renderPlanFingerprintSha256: field(record, 'renderPlanFingerprintSha256', name),
		nativeEffectFingerprintSha256: field(record, 'nativeEffectFingerprintSha256', name),
	}) as VideoFreezeFreshnessInputV1;
}

function disposition(
	status: VideoFreezeFallbackDispositionV1['status'],
	mode: VideoFreezeFallbackDispositionV1['mode'],
	changedComponents: readonly VideoFreezeChangedComponentV1[],
	reportsDegradation: boolean,
): VideoFreezeFallbackDispositionV1 {
	return Object.freeze({
		status,
		mode,
		changedComponents: Object.freeze([...changedComponents]),
		authoredStatePreserved: true as const,
		reportsDegradation,
	});
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !STABLE_ID.test(value)) throw new TypeError(`${name} must be a stable ID.`);
	return value;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${name} must be a lowercase SHA-256 digest.`);
	return value;
}

function hashCanonical(value: readonly string[]): string {
	return bytesToHex(sha256(TEXT_ENCODER.encode(JSON.stringify(value))));
}

function field(record: ClosedDomainRecord, name: string, owner: string): unknown {
	return readClosedDomainField(record, name, owner);
}
