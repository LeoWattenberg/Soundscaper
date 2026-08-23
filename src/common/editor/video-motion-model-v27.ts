/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Persisted, renderer-neutral motion state for the selected V27 finishing
 * route. Frames, pyramids, feature points, flow fields, and decoded analysis
 * bodies are deliberately absent: they are transient runtime values.
 */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';

export const VIDEO_MOTION_LIMITS_V1 = Object.freeze({
	maximumProcessors: 64,
	maximumFeatures: 4_096,
	maximumPyramidLevels: 8,
	maximumWindowRadius: 32,
	maximumTemporalRadius: 8,
	maximumAnalysisBytes: 1024 * 1024 * 1024,
});

export type VideoMotionProviderV1 = 'pyramidal-lucas-kanade';

interface VideoProcessorBaseV1 {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly enabled: boolean;
}

export interface VideoTrackingProcessorV1 extends VideoProcessorBaseV1 {
	readonly kind: 'tracking';
	readonly maximumFeatures: number;
	readonly quality: number;
	readonly minimumDistance: number;
	readonly windowRadius: number;
	readonly pyramidLevels: number;
}

export interface VideoSimilarityStabilizationProcessorV1 extends VideoProcessorBaseV1 {
	readonly kind: 'similarity-stabilization';
	readonly motionProvider: VideoMotionProviderV1;
	readonly analysisId: string;
	readonly strength: number;
}

export interface VideoSpatialDenoiseProcessorV1 extends VideoProcessorBaseV1 {
	readonly kind: 'spatial-denoise';
	readonly radius: number;
	readonly strength: number;
}

export interface VideoTemporalDenoiseProcessorV1 extends VideoProcessorBaseV1 {
	readonly kind: 'temporal-denoise';
	readonly motionProvider: VideoMotionProviderV1;
	readonly analysisId: string;
	readonly radius: number;
	readonly strength: number;
}

export type VideoProcessorV1 =
	| VideoTrackingProcessorV1
	| VideoSimilarityStabilizationProcessorV1
	| VideoSpatialDenoiseProcessorV1
	| VideoTemporalDenoiseProcessorV1;

export interface VideoProcessorStackV1 {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly sourceId: string;
	readonly processors: readonly VideoProcessorV1[];
}

export interface VideoMotionAnalysisReferenceV1 {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly sourceId: string;
	readonly processorStackId: string;
	readonly inputSha256: string;
	readonly settingsSha256: string;
	readonly storageKey: string;
	readonly sha256: string;
	readonly byteLength: number;
	readonly startFrame: number;
	readonly endFrame: number;
}

export interface VideoMotionFreshnessV1 {
	readonly sourceId: string;
	readonly processorStackId: string;
	readonly inputSha256: string;
	readonly settingsSha256: string;
}

const STACK_FIELDS = Object.freeze(['schemaVersion', 'id', 'sourceId', 'processors']);
const TRACKING_FIELDS = Object.freeze([
	'schemaVersion', 'id', 'kind', 'enabled', 'maximumFeatures', 'quality',
	'minimumDistance', 'windowRadius', 'pyramidLevels',
]);
const STABILIZATION_FIELDS = Object.freeze([
	'schemaVersion', 'id', 'kind', 'enabled', 'motionProvider', 'analysisId', 'strength',
]);
const SPATIAL_DENOISE_FIELDS = Object.freeze([
	'schemaVersion', 'id', 'kind', 'enabled', 'radius', 'strength',
]);
const TEMPORAL_DENOISE_FIELDS = Object.freeze([
	'schemaVersion', 'id', 'kind', 'enabled', 'motionProvider', 'analysisId', 'radius',
	'strength',
]);
const ANALYSIS_FIELDS = Object.freeze([
	'schemaVersion', 'id', 'sourceId', 'processorStackId', 'inputSha256',
	'settingsSha256', 'storageKey', 'sha256', 'byteLength', 'startFrame', 'endFrame',
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export function normalizeVideoProcessorStackV1(value: unknown): VideoProcessorStackV1 {
	const name = 'video processor stack';
	const record = readClosedDomainRecord(value, name, STACK_FIELDS);
	exact(field(record, 'schemaVersion', name), 1, `${name} schema`);
	const values = readClosedDomainArray(
		field(record, 'processors', name),
		'video processors',
		0,
		VIDEO_MOTION_LIMITS_V1.maximumProcessors,
	);
	const identities = new Set<string>();
	const processors = values.map((processor) => {
		const normalized = normalizeVideoProcessorV1(processor);
		if (identities.has(normalized.id)) {
			throw new RangeError(`Video processor identity ${normalized.id} is duplicated.`);
		}
		identities.add(normalized.id);
		return normalized;
	});
	return Object.freeze({
		schemaVersion: 1 as const,
		id: stableId(field(record, 'id', name), 'video processor stack ID'),
		sourceId: stableId(field(record, 'sourceId', name), 'video processor source ID'),
		processors: Object.freeze(processors),
	});
}

export function normalizeVideoProcessorV1(value: unknown): VideoProcessorV1 {
	const discriminant = readClosedDomainRecord(value, 'video processor', [
		...new Set([
			...TRACKING_FIELDS, ...STABILIZATION_FIELDS, ...SPATIAL_DENOISE_FIELDS,
			...TEMPORAL_DENOISE_FIELDS,
		]),
	], ['kind']);
	const kind = field(discriminant, 'kind', 'video processor');
	if (kind === 'tracking') return trackingProcessor(value);
	if (kind === 'similarity-stabilization') return stabilizationProcessor(value);
	if (kind === 'spatial-denoise') return spatialDenoiseProcessor(value);
	if (kind === 'temporal-denoise') return temporalDenoiseProcessor(value);
	throw new RangeError('The video processor kind is unsupported; optical flow is not a retime interpolation processor.');
}

export function normalizeVideoMotionAnalysisReferenceV1(
	value: unknown,
): VideoMotionAnalysisReferenceV1 {
	const name = 'video motion analysis reference';
	const record = readClosedDomainRecord(value, name, ANALYSIS_FIELDS);
	exact(field(record, 'schemaVersion', name), 1, `${name} schema`);
	const digest = sha(field(record, 'sha256', name), 'motion analysis digest');
	const storageKey = field(record, 'storageKey', name);
	if (storageKey !== `motion-sha256:${digest}`) {
		throw new TypeError('The motion analysis storage key must bind its SHA-256 digest.');
	}
	const startFrame = nonNegativeInteger(field(record, 'startFrame', name), 'motion analysis start frame');
	const endFrame = nonNegativeInteger(field(record, 'endFrame', name), 'motion analysis end frame');
	if (endFrame <= startFrame) throw new RangeError('The motion analysis frame range must be non-empty and ordered.');
	return Object.freeze({
		schemaVersion: 1 as const,
		id: stableId(field(record, 'id', name), 'motion analysis ID'),
		sourceId: stableId(field(record, 'sourceId', name), 'motion analysis source ID'),
		processorStackId: stableId(field(record, 'processorStackId', name), 'motion analysis processor stack ID'),
		inputSha256: sha(field(record, 'inputSha256', name), 'motion analysis input digest'),
		settingsSha256: sha(field(record, 'settingsSha256', name), 'motion analysis settings digest'),
		storageKey,
		sha256: digest,
		byteLength: boundedInteger(field(record, 'byteLength', name), 1, VIDEO_MOTION_LIMITS_V1.maximumAnalysisBytes, 'motion analysis bytes'),
		startFrame,
		endFrame,
	});
}

/** Final render callers must either recompute an analysis or surface this refusal. */
export function requireFreshVideoMotionAnalysisV1(
	value: unknown,
	expected: Readonly<VideoMotionFreshnessV1>,
): VideoMotionAnalysisReferenceV1 {
	const analysis = normalizeVideoMotionAnalysisReferenceV1(value);
	if (analysis.sourceId !== stableId(expected?.sourceId, 'expected motion source ID')) {
		throw new RangeError('The motion analysis is stale for the requested source.');
	}
	if (analysis.processorStackId !== stableId(expected?.processorStackId, 'expected processor stack ID')) {
		throw new RangeError('The motion analysis is stale for the requested processor stack.');
	}
	if (analysis.inputSha256 !== sha(expected?.inputSha256, 'expected motion input digest')) {
		throw new RangeError('The motion analysis is stale because its input digest changed.');
	}
	if (analysis.settingsSha256 !== sha(expected?.settingsSha256, 'expected motion settings digest')) {
		throw new RangeError('The motion analysis is stale because its settings digest changed.');
	}
	return analysis;
}

function trackingProcessor(value: unknown): VideoTrackingProcessorV1 {
	const name = 'video tracking processor';
	const record = readClosedDomainRecord(value, name, TRACKING_FIELDS);
	return Object.freeze({
		...processorBase(record, name, 'tracking'),
		maximumFeatures: boundedInteger(field(record, 'maximumFeatures', name), 1, VIDEO_MOTION_LIMITS_V1.maximumFeatures, 'tracking feature count'),
		quality: bounded(field(record, 'quality', name), Number.EPSILON, 1, 'tracking quality'),
		minimumDistance: bounded(field(record, 'minimumDistance', name), 0, 256, 'tracking minimum distance'),
		windowRadius: boundedInteger(field(record, 'windowRadius', name), 1, VIDEO_MOTION_LIMITS_V1.maximumWindowRadius, 'tracking window radius'),
		pyramidLevels: boundedInteger(field(record, 'pyramidLevels', name), 1, VIDEO_MOTION_LIMITS_V1.maximumPyramidLevels, 'tracking pyramid levels'),
	});
}

function stabilizationProcessor(value: unknown): VideoSimilarityStabilizationProcessorV1 {
	const name = 'video similarity stabilization processor';
	const record = readClosedDomainRecord(value, name, STABILIZATION_FIELDS);
	return Object.freeze({
		...processorBase(record, name, 'similarity-stabilization'),
		motionProvider: motionProvider(field(record, 'motionProvider', name)),
		analysisId: stableId(field(record, 'analysisId', name), 'stabilization analysis ID'),
		strength: bounded(field(record, 'strength', name), 0, 1, 'stabilization strength'),
	});
}

function spatialDenoiseProcessor(value: unknown): VideoSpatialDenoiseProcessorV1 {
	const name = 'video spatial denoise processor';
	const record = readClosedDomainRecord(value, name, SPATIAL_DENOISE_FIELDS);
	return Object.freeze({
		...processorBase(record, name, 'spatial-denoise'),
		radius: boundedInteger(field(record, 'radius', name), 1, 16, 'spatial denoise radius'),
		strength: bounded(field(record, 'strength', name), 0, 1, 'spatial denoise strength'),
	});
}

function temporalDenoiseProcessor(value: unknown): VideoTemporalDenoiseProcessorV1 {
	const name = 'video temporal denoise processor';
	const record = readClosedDomainRecord(value, name, TEMPORAL_DENOISE_FIELDS);
	return Object.freeze({
		...processorBase(record, name, 'temporal-denoise'),
		motionProvider: motionProvider(field(record, 'motionProvider', name)),
		analysisId: stableId(field(record, 'analysisId', name), 'temporal denoise analysis ID'),
		radius: boundedInteger(field(record, 'radius', name), 1, VIDEO_MOTION_LIMITS_V1.maximumTemporalRadius, 'temporal denoise radius'),
		strength: bounded(field(record, 'strength', name), 0, 1, 'temporal denoise strength'),
	});
}

function processorBase<const Kind extends VideoProcessorV1['kind']>(
	record: ClosedDomainRecord,
	name: string,
	kind: Kind,
): Readonly<{ schemaVersion: 1; id: string; kind: Kind; enabled: boolean }> {
	exact(field(record, 'schemaVersion', name), 1, `${name} schema`);
	exact(field(record, 'kind', name), kind, `${name} kind`);
	const enabled = field(record, 'enabled', name);
	if (typeof enabled !== 'boolean') throw new TypeError(`${name}.enabled must be boolean.`);
	return Object.freeze({
		schemaVersion: 1 as const,
		id: stableId(field(record, 'id', name), `${name} ID`),
		kind,
		enabled,
	});
}

function motionProvider(value: unknown): VideoMotionProviderV1 {
	return exact(value, 'pyramidal-lucas-kanade', 'video motion provider');
}

function field(record: ClosedDomainRecord, key: string, name: string): unknown {
	return readClosedDomainField(record, key, name);
}

function exact<const Value extends string | number>(value: unknown, expected: Value, name: string): Value {
	if (value !== expected) throw new RangeError(`${name} is unsupported.`);
	return expected;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${name} must be a stable ID.`);
	return value;
}

function sha(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${name} must be lowercase SHA-256.`);
	return value;
}

function bounded(value: unknown, minimum: number, maximum: number, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)
		|| value < minimum || value > maximum) {
		throw new RangeError(`${name} is outside its finite bound.`);
	}
	return value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`${name} is outside its integer bound.`);
	}
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
	return boundedInteger(value, 0, Number.MAX_SAFE_INTEGER, name);
}
