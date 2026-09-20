/* SPDX-License-Identifier: AGPL-3.0-only */

/** Renderer-owned, native-wire-independent Vamp analyzer contracts. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { roundRational, type TimeRoundingPolicy } from './timeline-time.ts';

export const VAMP_ANALYSIS_SCHEMA_VERSION = 1;
export const VAMP_ANALYSIS_CACHE_KEY_PREFIX = 'vamp-analysis-v1:';
export const VAMP_ANALYSIS_MAXIMUM_FEATURES = 100_000;

const MAXIMUM_ANALYZERS = 512;
const MAXIMUM_PARAMETERS = 512;
const MAXIMUM_OUTPUTS = 512;
const MAXIMUM_PROGRAMS = 512;
const MAXIMUM_FEATURE_VALUES = 4_096;
const MAXIMUM_ID_CHARACTERS = 512;
const MAXIMUM_TEXT_CHARACTERS = 4_096;
const NANOSECONDS_PER_SECOND = 1_000_000_000n;
const SHA256 = /^[a-f\d]{64}$/u;
const TEXT_ENCODER = new TextEncoder();

export type VampAnalysisScope = 'track' | 'master';
export type VampOutputSampleType =
	| 'one-sample-per-step'
	| 'fixed-sample-rate'
	| 'variable-sample-rate';

export interface VampParameterDescriptor {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly unit: string;
	readonly minValue: number;
	readonly maxValue: number;
	readonly defaultValue: number;
	readonly quantizeStep: number | null;
}

export interface VampOutputDescriptor {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly unit: string;
	readonly sampleType: VampOutputSampleType;
	readonly sampleRate: number | null;
	readonly hasDuration: boolean;
}

export interface VampAnalyzerDescriptor {
	readonly analyzerId: string;
	readonly stableId: string;
	readonly binarySha256: string;
	readonly name: string;
	readonly maker: string;
	readonly programs: readonly string[];
	readonly parameters: readonly Readonly<VampParameterDescriptor>[];
	readonly outputs: readonly Readonly<VampOutputDescriptor>[];
}

export interface VampParameterValue {
	readonly id: string;
	readonly value: number;
}

export interface VampAnalysisRequest {
	readonly schemaVersion: typeof VAMP_ANALYSIS_SCHEMA_VERSION;
	readonly analyzerId: string;
	readonly stableId: string;
	readonly binarySha256: string;
	readonly outputId: string;
	readonly program: string | null;
	readonly parameters: readonly Readonly<VampParameterValue>[];
	readonly scope: VampAnalysisScope;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly sampleRate: number;
}

/** Canonical Vamp time: signed seconds plus a non-negative sub-second remainder. */
export interface VampTimestamp {
	readonly seconds: number;
	readonly nanoseconds: number;
}

export interface VampAnalysisFeature {
	readonly timestamp: Readonly<VampTimestamp>;
	readonly duration: Readonly<VampTimestamp> | null;
	readonly values: readonly number[];
	readonly label: string;
}

export interface VampAnalysisResult {
	readonly schemaVersion: typeof VAMP_ANALYSIS_SCHEMA_VERSION;
	readonly request: Readonly<VampAnalysisRequest>;
	readonly features: readonly Readonly<VampAnalysisFeature>[];
}

export interface VampAnalysisRepeatRequest {
	readonly type: 'vamp';
	readonly request: Readonly<VampAnalysisRequest>;
}

const ANALYZER_KEYS = new Set([
	'analyzerId', 'stableId', 'binarySha256', 'name', 'maker', 'programs', 'parameters', 'outputs',
]);
const PARAMETER_DESCRIPTOR_KEYS = new Set([
	'id', 'name', 'description', 'unit', 'minValue', 'maxValue', 'defaultValue', 'quantizeStep',
]);
const OUTPUT_DESCRIPTOR_KEYS = new Set([
	'id', 'name', 'description', 'unit', 'sampleType', 'sampleRate', 'hasDuration',
]);
const REQUEST_KEYS = new Set([
	'schemaVersion', 'analyzerId', 'stableId', 'binarySha256', 'outputId', 'program', 'parameters',
	'scope', 'startFrame', 'endFrame', 'sampleRate',
]);
const PARAMETER_VALUE_KEYS = new Set(['id', 'value']);
const RESULT_KEYS = new Set(['schemaVersion', 'request', 'features']);
const FEATURE_KEYS = new Set(['timestamp', 'duration', 'values', 'label']);
const TIMESTAMP_KEYS = new Set(['seconds', 'nanoseconds']);

/** Admit the preload-facing analyzer catalog before any values reach React. */
export function normalizeVampAnalyzerCatalog(value: unknown): readonly Readonly<VampAnalyzerDescriptor>[] {
	const rows = denseArray(value, 'Vamp analyzer catalog', MAXIMUM_ANALYZERS);
	const analyzerIds = new Set<string>();
	return Object.freeze(rows.map((row, index) => {
		const candidate = closedRecord(row, ANALYZER_KEYS, `Vamp analyzer ${String(index)}`);
		const analyzerId = identifier(candidate.analyzerId, 'Vamp analyzer id');
		if (analyzerIds.has(analyzerId)) throw new RangeError(`Duplicate Vamp analyzer id: ${analyzerId}.`);
		analyzerIds.add(analyzerId);
		const parameters = normalizeParameterDescriptors(candidate.parameters);
		const outputs = normalizeOutputDescriptors(candidate.outputs);
		if (outputs.length === 0) throw new RangeError('A Vamp analyzer must expose at least one output.');
		return Object.freeze({
			analyzerId,
			stableId: identifier(candidate.stableId, 'Vamp stable id'),
			binarySha256: digest(candidate.binarySha256, 'Vamp analyzer binary SHA-256'),
			name: text(candidate.name, 'Vamp analyzer name', false),
			maker: text(candidate.maker, 'Vamp analyzer maker', true),
			programs: uniqueStrings(candidate.programs, 'Vamp analyzer programs', MAXIMUM_PROGRAMS),
			parameters,
			outputs,
		});
	}));
}

/** Normalize a complete request, including deterministic parameter ordering. */
export function normalizeVampAnalysisRequest(value: unknown): Readonly<VampAnalysisRequest> {
	const candidate = closedRecord(value, REQUEST_KEYS, 'Vamp analysis request');
	if (candidate.schemaVersion !== VAMP_ANALYSIS_SCHEMA_VERSION) {
		throw new RangeError('The Vamp analysis request schema version is unsupported.');
	}
	const startFrame = nonNegativeSafeInteger(candidate.startFrame, 'Vamp analysis start frame');
	const endFrame = nonNegativeSafeInteger(candidate.endFrame, 'Vamp analysis end frame');
	if (endFrame <= startFrame) throw new RangeError('The Vamp analysis end must be after its start.');
	return Object.freeze({
		schemaVersion: VAMP_ANALYSIS_SCHEMA_VERSION,
		analyzerId: identifier(candidate.analyzerId, 'Vamp analyzer id'),
		stableId: identifier(candidate.stableId, 'Vamp stable id'),
		binarySha256: digest(candidate.binarySha256, 'Vamp analyzer binary SHA-256'),
		outputId: identifier(candidate.outputId, 'Vamp output id'),
		program: candidate.program === null ? null
			: text(candidate.program, 'Vamp program', false, MAXIMUM_ID_CHARACTERS),
		parameters: normalizeParameterValues(candidate.parameters),
		scope: analysisScope(candidate.scope),
		startFrame,
		endFrame,
		sampleRate: positiveSafeInteger(candidate.sampleRate, 'Vamp analysis sample rate'),
	});
}

/** Validate a complete result and, when supplied, bind it to the submitted request. */
export function normalizeVampAnalysisResult(
	value: unknown,
	expectedRequestValue?: Readonly<VampAnalysisRequest>,
): Readonly<VampAnalysisResult> {
	const candidate = closedRecord(value, RESULT_KEYS, 'Vamp analysis result');
	if (candidate.schemaVersion !== VAMP_ANALYSIS_SCHEMA_VERSION) {
		throw new RangeError('The Vamp analysis result schema version is unsupported.');
	}
	const request = normalizeVampAnalysisRequest(candidate.request);
	if (expectedRequestValue !== undefined) {
		const expected = normalizeVampAnalysisRequest(expectedRequestValue);
		if (!sameRequest(request, expected)) {
			throw new Error('The Vamp analysis result does not match its submitted request.');
		}
	}
	const rows = denseArray(candidate.features, 'Vamp analysis features', VAMP_ANALYSIS_MAXIMUM_FEATURES);
	let previousTimestamp: bigint | null = null;
	const features = rows.map((row, index) => {
		const feature = normalizeFeature(row, request, index);
		const timestamp = timestampNanoseconds(feature.timestamp);
		if (previousTimestamp !== null && timestamp < previousTimestamp) {
			throw new RangeError('Vamp analysis features must be ordered by timestamp.');
		}
		previousTimestamp = timestamp;
		return feature;
	});
	return Object.freeze({
		schemaVersion: VAMP_ANALYSIS_SCHEMA_VERSION,
		request,
		features: Object.freeze(features),
	});
}

/** Hash rendered PCM authority and the complete canonical analyzer recipe. */
export function vampAnalysisCacheKey(
	requestValue: Readonly<VampAnalysisRequest>,
	renderedPcmSha256Value: unknown,
): string {
	const request = normalizeVampAnalysisRequest(requestValue);
	const renderedPcmSha256 = digest(renderedPcmSha256Value, 'Rendered PCM SHA-256');
	const descriptor = Object.freeze({
		schemaVersion: VAMP_ANALYSIS_SCHEMA_VERSION,
		renderedPcmSha256,
		request,
	});
	return `${VAMP_ANALYSIS_CACHE_KEY_PREFIX}${bytesToHex(sha256(
		TEXT_ENCODER.encode(JSON.stringify(descriptor)),
	))}`;
}

/** Capture a replayable request without retaining mutable UI state. */
export function createVampAnalysisRepeatRequest(
	requestValue: Readonly<VampAnalysisRequest>,
): Readonly<VampAnalysisRepeatRequest> {
	return Object.freeze({ type: 'vamp', request: normalizeVampAnalysisRequest(requestValue) });
}

/** Convert canonical Vamp time without a floating-point seconds round trip. */
export function vampTimestampToFrame(
	timestampValue: Readonly<VampTimestamp>,
	sampleRateValue: number,
	policy: TimeRoundingPolicy = 'point',
): number {
	const timestamp = normalizeTimestamp(timestampValue, 'Vamp timestamp', false);
	const sampleRate = positiveSafeInteger(sampleRateValue, 'Vamp timestamp sample rate');
	return roundRational(
		timestampNanoseconds(timestamp) * BigInt(sampleRate),
		NANOSECONDS_PER_SECOND,
		policy,
	);
}

/** Resolve one relative feature time to absolute project sample frames. */
export function vampFeatureFrameRange(
	requestValue: Readonly<VampAnalysisRequest>,
	featureValue: Readonly<VampAnalysisFeature>,
): Readonly<{ startFrame: number; endFrame: number; point: boolean }> {
	const request = normalizeVampAnalysisRequest(requestValue);
	const feature = normalizeFeature(featureValue, request, 0);
	const point = feature.duration === null;
	const startOffset = vampTimestampToFrame(
		feature.timestamp,
		request.sampleRate,
		point ? 'point' : 'enclosingStart',
	);
	const endOffset = point ? startOffset : roundRational(
		(timestampNanoseconds(feature.timestamp) + timestampNanoseconds(feature.duration!))
			* BigInt(request.sampleRate),
		NANOSECONDS_PER_SECOND,
		'enclosingEnd',
	);
	return Object.freeze({
		startFrame: safeAdd(request.startFrame, startOffset, 'Vamp feature start frame'),
		endFrame: safeAdd(request.startFrame, endOffset, 'Vamp feature end frame'),
		point,
	});
}

function normalizeParameterDescriptors(value: unknown): readonly Readonly<VampParameterDescriptor>[] {
	const rows = denseArray(value, 'Vamp parameter descriptors', MAXIMUM_PARAMETERS);
	const ids = new Set<string>();
	return Object.freeze(rows.map((row, index) => {
		const candidate = closedRecord(row, PARAMETER_DESCRIPTOR_KEYS, `Vamp parameter ${String(index)}`);
		const id = identifier(candidate.id, `Vamp parameter ${String(index)} id`);
		if (ids.has(id)) throw new RangeError(`Duplicate Vamp parameter id: ${id}.`);
		ids.add(id);
		const minValue = finite(candidate.minValue, `Vamp parameter ${id} minimum`);
		const maxValue = finite(candidate.maxValue, `Vamp parameter ${id} maximum`);
		if (maxValue < minValue) throw new RangeError(`Vamp parameter ${id} has reversed extents.`);
		const defaultValue = finite(candidate.defaultValue, `Vamp parameter ${id} default`);
		if (defaultValue < minValue || defaultValue > maxValue) {
			throw new RangeError(`Vamp parameter ${id} default is outside its extents.`);
		}
		const quantizeStep = candidate.quantizeStep === null ? null
			: positiveFinite(candidate.quantizeStep, `Vamp parameter ${id} quantize step`);
		return Object.freeze({
			id,
			name: text(candidate.name, `Vamp parameter ${id} name`, false),
			description: text(candidate.description, `Vamp parameter ${id} description`, true),
			unit: text(candidate.unit, `Vamp parameter ${id} unit`, true, MAXIMUM_ID_CHARACTERS),
			minValue,
			maxValue,
			defaultValue: canonicalZero(defaultValue),
			quantizeStep,
		});
	}));
}

function normalizeOutputDescriptors(value: unknown): readonly Readonly<VampOutputDescriptor>[] {
	const rows = denseArray(value, 'Vamp output descriptors', MAXIMUM_OUTPUTS);
	const ids = new Set<string>();
	return Object.freeze(rows.map((row, index) => {
		const candidate = closedRecord(row, OUTPUT_DESCRIPTOR_KEYS, `Vamp output ${String(index)}`);
		const id = identifier(candidate.id, `Vamp output ${String(index)} id`);
		if (ids.has(id)) throw new RangeError(`Duplicate Vamp output id: ${id}.`);
		ids.add(id);
		const sampleType = outputSampleType(candidate.sampleType);
		const sampleRate = candidate.sampleRate === null ? null
			: positiveFinite(candidate.sampleRate, `Vamp output ${id} sample rate`);
		if ((sampleType === 'fixed-sample-rate') !== (sampleRate !== null)) {
			throw new RangeError(`Vamp output ${id} sample rate disagrees with its sample type.`);
		}
		if (typeof candidate.hasDuration !== 'boolean') {
			throw new TypeError(`Vamp output ${id} duration capability must be boolean.`);
		}
		return Object.freeze({
			id,
			name: text(candidate.name, `Vamp output ${id} name`, false),
			description: text(candidate.description, `Vamp output ${id} description`, true),
			unit: text(candidate.unit, `Vamp output ${id} unit`, true, MAXIMUM_ID_CHARACTERS),
			sampleType,
			sampleRate,
			hasDuration: candidate.hasDuration,
		});
	}));
}

function normalizeParameterValues(value: unknown): readonly Readonly<VampParameterValue>[] {
	const rows = denseArray(value, 'Vamp parameter values', MAXIMUM_PARAMETERS);
	const ids = new Set<string>();
	const values = rows.map((row, index) => {
		const candidate = closedRecord(row, PARAMETER_VALUE_KEYS, `Vamp parameter value ${String(index)}`);
		const id = identifier(candidate.id, `Vamp parameter value ${String(index)} id`);
		if (ids.has(id)) throw new RangeError(`Duplicate Vamp parameter value id: ${id}.`);
		ids.add(id);
		return Object.freeze({ id, value: canonicalZero(finite(candidate.value, `Vamp parameter ${id} value`)) });
	});
	values.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
	return Object.freeze(values);
}

function normalizeFeature(
	value: unknown,
	request: Readonly<VampAnalysisRequest>,
	index: number,
): Readonly<VampAnalysisFeature> {
	const candidate = closedRecord(value, FEATURE_KEYS, `Vamp feature ${String(index)}`);
	const timestamp = normalizeTimestamp(candidate.timestamp, `Vamp feature ${String(index)} timestamp`, false);
	const duration = candidate.duration === null ? null
		: normalizeTimestamp(candidate.duration, `Vamp feature ${String(index)} duration`, true);
	const values = denseArray(candidate.values, `Vamp feature ${String(index)} values`, MAXIMUM_FEATURE_VALUES)
		.map((item, valueIndex) => canonicalZero(finite(
			item,
			`Vamp feature ${String(index)} value ${String(valueIndex)}`,
		)));
	assertFeatureInsideRange(timestamp, duration, request, index);
	return Object.freeze({
		timestamp,
		duration,
		values: Object.freeze(values),
		label: text(candidate.label, `Vamp feature ${String(index)} label`, true),
	});
}

function normalizeTimestamp(value: unknown, name: string, duration: boolean): Readonly<VampTimestamp> {
	const candidate = closedRecord(value, TIMESTAMP_KEYS, name);
	const seconds = safeInteger(candidate.seconds, `${name} seconds`);
	const nanoseconds = nonNegativeSafeInteger(candidate.nanoseconds, `${name} nanoseconds`);
	if (nanoseconds >= Number(NANOSECONDS_PER_SECOND)) {
		throw new RangeError(`${name} nanoseconds must be less than one second.`);
	}
	if (duration && seconds < 0) throw new RangeError(`${name} must not be negative.`);
	return Object.freeze({ seconds, nanoseconds });
}

function assertFeatureInsideRange(
	timestamp: Readonly<VampTimestamp>,
	duration: Readonly<VampTimestamp> | null,
	request: Readonly<VampAnalysisRequest>,
	index: number,
): void {
	const start = timestampNanoseconds(timestamp);
	const end = start + (duration === null ? 0n : timestampNanoseconds(duration));
	const frameCount = BigInt(request.endFrame - request.startFrame);
	const rate = BigInt(request.sampleRate);
	if (start < 0n || end < start
		|| start * rate > frameCount * NANOSECONDS_PER_SECOND
		|| end * rate > frameCount * NANOSECONDS_PER_SECOND) {
		throw new RangeError(`Vamp feature ${String(index)} is outside its analysis range.`);
	}
}

function timestampNanoseconds(value: Readonly<VampTimestamp>): bigint {
	return BigInt(value.seconds) * NANOSECONDS_PER_SECOND + BigInt(value.nanoseconds);
}

function sameRequest(left: Readonly<VampAnalysisRequest>, right: Readonly<VampAnalysisRequest>): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function analysisScope(value: unknown): VampAnalysisScope {
	if (value !== 'track' && value !== 'master') {
		throw new TypeError('Vamp analysis scope must be track or master.');
	}
	return value;
}

function outputSampleType(value: unknown): VampOutputSampleType {
	if (value !== 'one-sample-per-step' && value !== 'fixed-sample-rate'
		&& value !== 'variable-sample-rate') {
		throw new TypeError('The Vamp output sample type is unsupported.');
	}
	return value;
}

function uniqueStrings(value: unknown, name: string, maximum: number): readonly string[] {
	const rows = denseArray(value, name, maximum);
	const seen = new Set<string>();
	return Object.freeze(rows.map((row, index) => {
		const item = text(row, `${name} ${String(index)}`, false, MAXIMUM_ID_CHARACTERS);
		if (seen.has(item)) throw new RangeError(`Duplicate ${name} entry: ${item}.`);
		seen.add(item);
		return item;
	}));
}

function closedRecord(value: unknown, keys: ReadonlySet<string>, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain object.`);
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || !keys.has(key)) throw new RangeError(`Unknown ${name} property ${String(key)}.`);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} property ${key} must be an enumerable data property.`);
		}
	}
	for (const key of keys) if (!Object.hasOwn(value, key)) throw new TypeError(`${name} is missing ${key}.`);
	return value as Record<string, unknown>;
}

function denseArray(value: unknown, name: string, maximum: number): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	if (value.length > maximum) throw new RangeError(`${name} exceeds its ${String(maximum)}-entry limit.`);
	for (let index = 0; index < value.length; index += 1) {
		if (!Object.hasOwn(value, index)) throw new TypeError(`${name} must be dense.`);
	}
	return value;
}

function identifier(value: unknown, name: string): string {
	return text(value, name, false, MAXIMUM_ID_CHARACTERS);
}

function text(value: unknown, name: string, empty: boolean, maximum = MAXIMUM_TEXT_CHARACTERS): string {
	if (typeof value !== 'string' || (!empty && value.length === 0) || value.length > maximum || value.includes('\0')) {
		throw new TypeError(`${name} must be ${empty ? 'a' : 'a non-empty'} bounded string.`);
	}
	return value;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${name} must be lowercase hexadecimal.`);
	return value;
}

function finite(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be finite.`);
	return value;
}

function positiveFinite(value: unknown, name: string): number {
	const result = finite(value, name);
	if (result <= 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function safeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`${name} must be a safe integer.`);
	return value;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	const result = safeInteger(value, name);
	if (result < 0) throw new RangeError(`${name} must not be negative.`);
	return result;
}

function positiveSafeInteger(value: unknown, name: string): number {
	const result = safeInteger(value, name);
	if (result <= 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function safeAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return result;
}

function canonicalZero(value: number): number {
	return Object.is(value, -0) ? 0 : value;
}
