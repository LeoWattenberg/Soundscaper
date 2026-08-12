/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	TRANSIENT_ANALYSIS_ALGORITHM,
	normalizeTransientAnalysisChannelPolicy,
	normalizeTransientAnalysisParameters,
	type PcmTransient,
	type TransientAnalysisChannelPolicy,
	type TransientAnalysisParameters,
	type TransientAnalysisResult,
	type TransientAnalysisSourceRange,
} from '../transient-analysis.ts';
import type { DerivativeCacheRecord } from './derivative-cache-policy.ts';
import { isMediaContentSha256 } from './media-content-provenance.ts';

export const TRANSIENT_ANALYSIS_DERIVATIVE_BINDING_VERSION = 1;
export const TRANSIENT_ANALYSIS_CACHE_RECORD_VERSION = 1;
export const TRANSIENT_ANALYSIS_CACHE_MAXIMUM_TRANSIENTS = 1_000_000;

export interface TransientAnalysisAlgorithm {
	readonly id: string;
	readonly revision: number;
}

export interface TransientAnalysisIdentity {
	readonly key: string;
	readonly derivativeBindingVersion: typeof TRANSIENT_ANALYSIS_DERIVATIVE_BINDING_VERSION;
	readonly sourceSha256: string;
	readonly sourceRange: Readonly<TransientAnalysisSourceRange>;
	readonly channelPolicy: TransientAnalysisChannelPolicy;
	readonly algorithmId: string;
	readonly algorithmRevision: number;
	readonly parameters: Readonly<TransientAnalysisParameters>;
}

export interface TransientAnalysisIdentityInput {
	readonly sourceSha256: unknown;
	readonly sourceRange: unknown;
	readonly channelPolicy?: unknown;
	readonly parameters?: unknown;
	readonly algorithm?: unknown;
}

export interface TransientAnalysisCacheRecord extends DerivativeCacheRecord, TransientAnalysisIdentity {
	readonly key: string;
	readonly size: number;
	readonly recordVersion: typeof TRANSIENT_ANALYSIS_CACHE_RECORD_VERSION;
	readonly transients: readonly Readonly<PcmTransient>[];
	readonly payloadByteLength: number;
	readonly payloadSha256: string;
}

export type TransientAnalysisCacheInspection = Readonly<{
	status: 'hit' | 'miss' | 'stale' | 'corrupt';
	discard: boolean;
	analysis: Readonly<TransientAnalysisResult> | null;
}>;

const KEY_PREFIX = 'transient-analysis-sha256:';
const MAXIMUM_ALGORITHM_ID_CHARACTERS = 128;
const TEXT_ENCODER = new TextEncoder();
const CACHE_RECORD_KEYS = new Set([
	'key', 'size', 'recordVersion', 'derivativeBindingVersion', 'sourceSha256',
	'sourceRange', 'channelPolicy', 'algorithmId', 'algorithmRevision', 'parameters',
	'transients', 'payloadByteLength', 'payloadSha256',
]);
const IDENTITY_KEYS = new Set([
	'key', 'derivativeBindingVersion', 'sourceSha256', 'sourceRange', 'channelPolicy',
	'algorithmId', 'algorithmRevision', 'parameters',
]);
const SOURCE_RANGE_KEYS = new Set(['startFrame', 'endFrame']);
const TRANSIENT_KEYS = new Set(['sourceFrame', 'strength']);
const ANALYSIS_KEYS = new Set([
	'algorithmId', 'algorithmRevision', 'channelPolicy', 'parameters', 'sourceRange', 'transients',
]);

/** Derive one opaque cache identity from every authority input. */
export function transientAnalysisIdentity(
	input: Readonly<TransientAnalysisIdentityInput>,
): Readonly<TransientAnalysisIdentity> {
	if (!input || typeof input !== 'object') throw new TypeError('A transient analysis identity is required.');
	if (!isMediaContentSha256(input.sourceSha256)) {
		throw new TypeError('A verified source media lowercase SHA-256 digest is required.');
	}
	const sourceRange = normalizeSourceRange(input.sourceRange);
	const channelPolicy = normalizeTransientAnalysisChannelPolicy(input.channelPolicy);
	const parameters = normalizeTransientAnalysisParameters(input.parameters);
	const algorithm = normalizeTransientAnalysisAlgorithm(input.algorithm);
	const descriptor = identityDescriptor(
		input.sourceSha256,
		sourceRange,
		channelPolicy,
		algorithm,
		parameters,
	);
	const digest = bytesToHex(sha256(TEXT_ENCODER.encode(JSON.stringify(descriptor))));
	return Object.freeze({
		key: `${KEY_PREFIX}${digest}`,
		derivativeBindingVersion: TRANSIENT_ANALYSIS_DERIVATIVE_BINDING_VERSION,
		sourceSha256: input.sourceSha256,
		sourceRange,
		channelPolicy,
		algorithmId: algorithm.id,
		algorithmRevision: algorithm.revision,
		parameters,
	});
}

export function normalizeTransientAnalysisAlgorithm(
	value: unknown = TRANSIENT_ANALYSIS_ALGORITHM,
): Readonly<TransientAnalysisAlgorithm> {
	const candidate = closedRecord(value, new Set(['id', 'revision']), 'transient analysis algorithm');
	const id = nonEmptyString(candidate.id, 'A transient analysis algorithm id is required.');
	if (id.length > MAXIMUM_ALGORITHM_ID_CHARACTERS) {
		throw new RangeError(
			`A transient analysis algorithm id cannot exceed ${String(MAXIMUM_ALGORITHM_ID_CHARACTERS)} characters.`,
		);
	}
	const revision = positiveSafeInteger(candidate.revision, 'algorithm revision');
	return Object.freeze({ id, revision });
}

/** Build an immutable, self-bound cache row compatible with derivative eviction accounting. */
export function createTransientAnalysisCacheRecord(
	identityValue: Readonly<TransientAnalysisIdentity>,
	analysisValue: Readonly<TransientAnalysisResult>,
): Readonly<TransientAnalysisCacheRecord> {
	const identity = normalizeTransientAnalysisIdentity(identityValue);
	const analysis = normalizeAnalysis(analysisValue, identity);
	const payload = payloadBytes(identity.key, analysis.transients);
	return Object.freeze({
		...identity,
		size: payload.byteLength,
		recordVersion: TRANSIENT_ANALYSIS_CACHE_RECORD_VERSION,
		transients: analysis.transients,
		payloadByteLength: payload.byteLength,
		payloadSha256: bytesToHex(sha256(payload)),
	});
}

/** Validate cache data without accepting normalization that could hide tampering. */
export function normalizeTransientAnalysisCacheRecord(
	value: unknown,
): Readonly<TransientAnalysisCacheRecord> {
	const candidate = closedRecord(value, CACHE_RECORD_KEYS, 'transient analysis cache record');
	if (candidate.recordVersion !== TRANSIENT_ANALYSIS_CACHE_RECORD_VERSION) {
		throw new RangeError('The transient analysis cache record version is unsupported.');
	}
	if (candidate.derivativeBindingVersion !== TRANSIENT_ANALYSIS_DERIVATIVE_BINDING_VERSION) {
		throw new RangeError('The transient analysis derivative binding version is unsupported.');
	}
	const identity = transientAnalysisIdentity({
		sourceSha256: candidate.sourceSha256,
		sourceRange: candidate.sourceRange,
		channelPolicy: candidate.channelPolicy,
		parameters: candidate.parameters,
		algorithm: { id: candidate.algorithmId, revision: candidate.algorithmRevision },
	});
	if (candidate.key !== identity.key) {
		throw new Error('The transient analysis cache key does not match its authority inputs.');
	}
	const transients = normalizeTransients(candidate.transients, identity.sourceRange);
	const payload = payloadBytes(identity.key, transients);
	const size = nonNegativeSafeInteger(candidate.size, 'cache record size');
	const payloadByteLength = nonNegativeSafeInteger(
		candidate.payloadByteLength,
		'cache payload byte length',
	);
	if (size !== payload.byteLength || payloadByteLength !== payload.byteLength) {
		throw new Error('The transient analysis cache payload byte length is corrupt.');
	}
	if (!isMediaContentSha256(candidate.payloadSha256)
		|| candidate.payloadSha256 !== bytesToHex(sha256(payload))) {
		throw new Error('The transient analysis cache payload digest is corrupt.');
	}
	return Object.freeze({
		...identity,
		size,
		recordVersion: TRANSIENT_ANALYSIS_CACHE_RECORD_VERSION,
		transients,
		payloadByteLength,
		payloadSha256: candidate.payloadSha256,
	});
}

/** Classify disposable cache state without ever returning stale or corrupt data. */
export function inspectTransientAnalysisCacheRecord(
	value: unknown,
	expectedIdentityValue: Readonly<TransientAnalysisIdentity>,
): TransientAnalysisCacheInspection {
	const expected = normalizeTransientAnalysisIdentity(expectedIdentityValue);
	if (value === null || value === undefined) return inspection('miss', false, null);
	let record: Readonly<TransientAnalysisCacheRecord>;
	try {
		record = normalizeTransientAnalysisCacheRecord(value);
	} catch {
		return inspection('corrupt', true, null);
	}
	if (!sameIdentity(record, expected)) return inspection('stale', true, null);
	return inspection('hit', false, analysisFromRecord(record));
}

function normalizeTransientAnalysisIdentity(
	value: unknown,
): Readonly<TransientAnalysisIdentity> {
	const candidate = closedRecord(value, IDENTITY_KEYS, 'transient analysis identity');
	if (candidate.derivativeBindingVersion !== TRANSIENT_ANALYSIS_DERIVATIVE_BINDING_VERSION) {
		throw new RangeError('The transient analysis derivative binding version is unsupported.');
	}
	const identity = transientAnalysisIdentity({
		sourceSha256: candidate.sourceSha256,
		sourceRange: candidate.sourceRange,
		channelPolicy: candidate.channelPolicy,
		parameters: candidate.parameters,
		algorithm: { id: candidate.algorithmId, revision: candidate.algorithmRevision },
	});
	if (candidate.key !== identity.key) {
		throw new Error('The transient analysis identity key does not match its authority inputs.');
	}
	return identity;
}

function normalizeAnalysis(
	value: unknown,
	identity: Readonly<TransientAnalysisIdentity>,
): Readonly<TransientAnalysisResult> {
	const candidate = closedRecord(value, ANALYSIS_KEYS, 'transient analysis result');
	const algorithm = normalizeTransientAnalysisAlgorithm({
		id: candidate.algorithmId,
		revision: candidate.algorithmRevision,
	});
	const sourceRange = normalizeSourceRange(candidate.sourceRange);
	const channelPolicy = normalizeTransientAnalysisChannelPolicy(candidate.channelPolicy);
	const parameters = normalizeTransientAnalysisParameters(candidate.parameters);
	if (algorithm.id !== identity.algorithmId || algorithm.revision !== identity.algorithmRevision
		|| channelPolicy !== identity.channelPolicy || !sameRange(sourceRange, identity.sourceRange)
		|| !sameParameters(parameters, identity.parameters)) {
		throw new Error('The transient analysis result does not match its derivative identity.');
	}
	return Object.freeze({
		algorithmId: algorithm.id,
		algorithmRevision: algorithm.revision,
		channelPolicy,
		parameters,
		sourceRange,
		transients: normalizeTransients(candidate.transients, sourceRange),
	});
}

function normalizeSourceRange(value: unknown): Readonly<TransientAnalysisSourceRange> {
	const candidate = closedRecord(value, SOURCE_RANGE_KEYS, 'transient analysis source range');
	const startFrame = nonNegativeSafeInteger(candidate.startFrame, 'source range startFrame');
	const endFrame = nonNegativeSafeInteger(candidate.endFrame, 'source range endFrame');
	if (endFrame < startFrame) {
		throw new RangeError('The transient analysis source range end must not precede its start.');
	}
	return Object.freeze({ startFrame, endFrame });
}

function normalizeTransients(
	value: unknown,
	range: Readonly<TransientAnalysisSourceRange>,
): readonly Readonly<PcmTransient>[] {
	const values = denseArray(value, 'transient analysis points');
	if (values.length > TRANSIENT_ANALYSIS_CACHE_MAXIMUM_TRANSIENTS) {
		throw new RangeError('The transient analysis cache exceeds its point limit.');
	}
	const normalized: Readonly<PcmTransient>[] = [];
	let previousFrame = -1;
	for (const [index, item] of values.entries()) {
		const candidate = closedRecord(item, TRANSIENT_KEYS, `transient analysis point ${String(index)}`);
		const sourceFrame = nonNegativeSafeInteger(
			candidate.sourceFrame,
			`transient analysis point ${String(index)} sourceFrame`,
		);
		const strength = finiteStrength(candidate.strength, index);
		if (sourceFrame < range.startFrame || sourceFrame >= range.endFrame) {
			throw new RangeError(`Transient analysis point ${String(index)} is outside its source range.`);
		}
		if (sourceFrame <= previousFrame) {
			throw new RangeError('Transient analysis source frames must be strictly increasing.');
		}
		previousFrame = sourceFrame;
		normalized.push(Object.freeze({ sourceFrame, strength }));
	}
	return Object.freeze(normalized);
}

function analysisFromRecord(
	record: Readonly<TransientAnalysisCacheRecord>,
): Readonly<TransientAnalysisResult> {
	return Object.freeze({
		algorithmId: record.algorithmId,
		algorithmRevision: record.algorithmRevision,
		channelPolicy: record.channelPolicy,
		parameters: record.parameters,
		sourceRange: record.sourceRange,
		transients: record.transients,
	});
}

function sameIdentity(
	left: Readonly<TransientAnalysisIdentity>,
	right: Readonly<TransientAnalysisIdentity>,
): boolean {
	return left.key === right.key
		&& left.derivativeBindingVersion === right.derivativeBindingVersion
		&& left.sourceSha256 === right.sourceSha256
		&& sameRange(left.sourceRange, right.sourceRange)
		&& left.channelPolicy === right.channelPolicy
		&& left.algorithmId === right.algorithmId
		&& left.algorithmRevision === right.algorithmRevision
		&& sameParameters(left.parameters, right.parameters);
}

function sameRange(
	left: Readonly<TransientAnalysisSourceRange>,
	right: Readonly<TransientAnalysisSourceRange>,
): boolean {
	return left.startFrame === right.startFrame && left.endFrame === right.endFrame;
}

function sameParameters(
	left: Readonly<TransientAnalysisParameters>,
	right: Readonly<TransientAnalysisParameters>,
): boolean {
	return left.windowFrames === right.windowFrames
		&& left.hopFrames === right.hopFrames
		&& left.baselineWindowHops === right.baselineWindowHops
		&& left.sensitivity === right.sensitivity
		&& left.minimumSpacingFrames === right.minimumSpacingFrames
		&& left.floorDbfs === right.floorDbfs;
}

function identityDescriptor(
	sourceSha256: string,
	range: Readonly<TransientAnalysisSourceRange>,
	channelPolicy: TransientAnalysisChannelPolicy,
	algorithm: Readonly<TransientAnalysisAlgorithm>,
	parameters: Readonly<TransientAnalysisParameters>,
): readonly unknown[] {
	return [
		'soundscaper-transient-analysis-identity',
		TRANSIENT_ANALYSIS_DERIVATIVE_BINDING_VERSION,
		['source-sha256', sourceSha256],
		['source-range', range.startFrame, range.endFrame],
		['channel-policy', channelPolicy],
		['algorithm', algorithm.id, algorithm.revision],
		['parameters',
			['windowFrames', parameters.windowFrames],
			['hopFrames', parameters.hopFrames],
			['baselineWindowHops', parameters.baselineWindowHops],
			['sensitivity', parameters.sensitivity],
			['minimumSpacingFrames', parameters.minimumSpacingFrames],
			['floorDbfs', parameters.floorDbfs]],
	];
}

function payloadBytes(key: string, transients: readonly Readonly<PcmTransient>[]): Uint8Array {
	return TEXT_ENCODER.encode(JSON.stringify([
		'soundscaper-transient-analysis-payload',
		TRANSIENT_ANALYSIS_CACHE_RECORD_VERSION,
		key,
		transients.map(({ sourceFrame, strength }) => [sourceFrame, strength]),
	]));
}

function inspection(
	status: TransientAnalysisCacheInspection['status'],
	discard: boolean,
	analysis: Readonly<TransientAnalysisResult> | null,
): TransientAnalysisCacheInspection {
	return Object.freeze({ status, discard, analysis });
}

function closedRecord(
	value: unknown,
	keys: ReadonlySet<string>,
	label: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object.`);
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${label} must be a plain object.`);
	}
	const ownKeys = Reflect.ownKeys(value);
	if (ownKeys.length !== keys.size || ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))) {
		throw new TypeError(`${label} has unsupported or missing fields.`);
	}
	const output: Record<string, unknown> = {};
	for (const key of ownKeys) {
		if (typeof key !== 'string') throw new TypeError(`${label} has a symbol field.`);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label}.${key} must be an enumerable data property.`);
		}
		output[key] = descriptor.value;
	}
	return output;
}

function denseArray(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
	const length = nonNegativeSafeInteger(
		Object.getOwnPropertyDescriptor(value, 'length')?.value,
		`${label} length`,
	);
	const values: unknown[] = [];
	for (let index = 0; index < length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label} must be dense enumerable data.`);
		}
		values.push(descriptor.value);
	}
	if (Reflect.ownKeys(value).length !== length + 1) {
		throw new TypeError(`${label} has unsupported fields.`);
	}
	return values;
}

function finiteStrength(value: unknown, index: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) {
		throw new RangeError(`Transient analysis point ${String(index)} strength must be finite above zero through one.`);
	}
	if (Math.round(value * 1_000_000) / 1_000_000 !== value) {
		throw new RangeError(`Transient analysis point ${String(index)} strength is not canonically quantized.`);
	}
	return Object.is(value, -0) ? 0 : value;
}

function nonEmptyString(value: unknown, message: string): string {
	const text = typeof value === 'string' ? value.trim() : '';
	if (!text) throw new TypeError(message);
	return text;
}

function positiveSafeInteger(value: unknown, field: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${field} must be a positive safe integer.`);
	}
	return Number(value);
}

function nonNegativeSafeInteger(value: unknown, field: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${field} must be a non-negative safe integer.`);
	}
	return Object.is(value, -0) ? 0 : Number(value);
}
