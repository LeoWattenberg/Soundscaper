/* SPDX-License-Identifier: AGPL-3.0-only */

import { FAST_RENDER_THRESHOLDS } from '../export.js';
import { normalizeMediaChannelMapping } from '../media-export.js';
import {
	MAXIMUM_OFFLINE_RENDER_OUTPUT_USEFUL_BINARY_BYTES,
	planOfflineRenderOutputAdmission,
	type OfflineRenderOutputAdmissionPlan,
	type OfflineRenderOutputGeometry,
} from '../engine/offline-render-admission.ts';

type RecordValue = Readonly<Record<string, unknown>>;

export type DirectAudioRenderStrategy = 'offline' | 'realtime-stream';

const RENDER_FIELDS = Object.freeze([
	'strategy', 'fast', 'outputBytes', 'livePcmBytes', 'totalBytes', 'thresholds',
	'reason', 'offlineRenderAdmission',
]);
const ADMISSION_FIELDS = Object.freeze([
	'admitted', 'strategy', 'reason', 'geometry', 'preRollFrames', 'graphLatencyFrames',
	'peakUsefulBinaryBytes', 'maximumUsefulBinaryBytes', 'outputAdmission',
]);
const GEOMETRY_FIELDS = Object.freeze([
	'channelCount', 'sampleRate', 'contextFrames', 'captureOffsetFrames', 'requestedFrames',
] as const);
const OUTPUT_ADMISSION_FIELDS = Object.freeze([
	...GEOMETRY_FIELDS,
	'maximumUsefulBinaryBytes', 'contextOutput', 'cropOutput', 'peakUsefulBinaryWorkingSet',
	'browserHeapBytes', 'processResidentSetBytes', 'garbageCollectionHeadroomBytes',
]);
const OUTPUT_FIELDS = Object.freeze([
	'kind', 'fileName', 'trackId', 'includeMaster', 'respectMuteSolo',
]);
const RANGE_FIELDS = Object.freeze(['startFrame', 'endFrame', 'durationFrames']);

/** Preserve existing realtime admission while requiring exact central evidence for offline work. */
export function directAudioRenderStrategy(value: unknown): DirectAudioRenderStrategy | null {
	try {
		const plan = recordValue(value);
		const render = recordValue(plan?.render);
		if (render?.strategy === 'realtime-stream') return 'realtime-stream';
		return isDirectOfflineAudioMixPlanInternal(plan) ? 'offline' : null;
	} catch {
		return null;
	}
}

/** Admit only a canonical single mix backed by the central offline-output planner. */
export function isDirectOfflineAudioMixPlan(value: unknown): boolean {
	try { return isDirectOfflineAudioMixPlanInternal(recordValue(value)); } catch { return false; }
}

function isDirectOfflineAudioMixPlanInternal(plan: RecordValue | null): boolean {
	if (!plan || plan.mode !== 'mix' || plan.archive !== null) return false;
	const outputs = plan.outputs;
	if (!Array.isArray(outputs) || outputs.length !== 1 || !canonicalMixOutput(outputs[0])) return false;
	const range = recordValue(plan.range);
	if (!range || !sameKeys(range, RANGE_FIELDS)
		|| !safeInteger(range.startFrame, 0)
		|| !safeInteger(range.endFrame, 1)
		|| !safeInteger(range.durationFrames, 1)
		|| Number(range.endFrame) <= Number(range.startFrame)
		|| range.durationFrames !== Number(range.endFrame) - Number(range.startFrame)
		|| !safeInteger(plan.tailFrames, 0)
		|| !safeInteger(plan.sampleRate, 1)
		|| !safeInteger(plan.outputFrames, 1)
		|| !safeInteger(plan.channelCount, 1, 32)
		|| !safeInteger(plan.outputBytesPerRender, 1)) return false;
	let expectedPcmBytes: number;
	let requestedRenderFrames: number;
	try {
		expectedPcmBytes = multiplySafe(
			Number(plan.outputFrames), Number(plan.channelCount), Float32Array.BYTES_PER_ELEMENT,
		);
		requestedRenderFrames = addSafe(Number(range.durationFrames), Number(plan.tailFrames));
	} catch {
		return false;
	}
	if (plan.outputBytesPerRender !== expectedPcmBytes) return false;
	const encoding = recordValue(plan.encoding);
	const mapping = recordValue(plan.channelMapping);
	const encodingMapping = recordValue(encoding?.channelMapping);
	if (!encoding || !mapping || !encodingMapping
		|| encoding.sampleRate !== plan.sampleRate
		|| encoding.channelCount !== plan.channelCount
		|| !safeInteger(encoding.inputChannelCount, 1, 32)
		|| mapping.inputChannelCount !== encoding.inputChannelCount
		|| mapping.outputChannelCount !== plan.channelCount
		|| encodingMapping.inputChannelCount !== encoding.inputChannelCount
		|| encodingMapping.outputChannelCount !== plan.channelCount
		|| !sameJsonValue(mapping, encodingMapping)) return false;
	try {
		const mode = mapping.mode;
		const requestedMapping = mode === 'preserve' || mode === 'mono' || mode === 'stereo'
			? mode
			: mode === 'custom' ? mapping : null;
		if (requestedMapping === null) return false;
		const normalizedMapping = (normalizeMediaChannelMapping as unknown as (
			inputChannelCount: number,
			value: unknown,
		) => unknown)(
			Number(encoding.inputChannelCount),
			requestedMapping,
		);
		if (!sameJsonValue(mapping, normalizedMapping)) return false;
	} catch {
		return false;
	}

	const render = recordValue(plan.render);
	if (!render || !sameKeys(render, RENDER_FIELDS)
		|| render.strategy !== 'offline' || render.fast !== true || render.reason !== null
		|| render.outputBytes !== plan.outputBytesPerRender
		|| !safeInteger(render.livePcmBytes, 0)
		|| !safeInteger(render.totalBytes, 1)
		|| render.totalBytes !== addSafeOrNull(Number(render.outputBytes), Number(render.livePcmBytes))
		|| !canonicalThresholds(render.thresholds)
		|| Number(render.outputBytes) > render.thresholds.outputBytes
		|| Number(render.totalBytes) > render.thresholds.totalBytes) return false;
	return canonicalOfflineAdmission(
		render.offlineRenderAdmission,
		plan,
		range,
		Number(encoding.inputChannelCount),
		Math.max(1, requestedRenderFrames),
	);
}

function canonicalOfflineAdmission(
	value: unknown,
	plan: RecordValue,
	range: RecordValue,
	inputChannelCount: number,
	requestedRenderFrames: number,
): boolean {
	const admission = recordValue(value);
	const geometry = recordValue(admission?.geometry);
	if (!admission || !geometry
		|| !sameKeys(admission, ADMISSION_FIELDS)
		|| !sameKeys(geometry, GEOMETRY_FIELDS)
		|| admission.admitted !== true
		|| admission.strategy !== 'offline'
		|| admission.reason !== null
		|| !safeInteger(admission.preRollFrames, 0)
		|| !safeInteger(admission.graphLatencyFrames, 0)
		|| !safeInteger(admission.peakUsefulBinaryBytes, 1)
		|| admission.maximumUsefulBinaryBytes !== MAXIMUM_OFFLINE_RENDER_OUTPUT_USEFUL_BINARY_BYTES
		|| !canonicalGeometry(geometry)
		|| geometry.channelCount !== inputChannelCount
		|| geometry.requestedFrames !== requestedRenderFrames
		|| admission.preRollFrames !== exactPreRollFrames(
			Number(range.startFrame), Number(geometry.sampleRate),
		)
		|| geometry.captureOffsetFrames !== addSafeOrNull(
			Number(admission.preRollFrames), Number(admission.graphLatencyFrames),
		)) return false;
	let expectedOutputFrames: number;
	try {
		expectedOutputFrames = addSafe(
			ceilScaledFrames(Number(range.durationFrames), Number(plan.sampleRate), Number(geometry.sampleRate)),
			ceilScaledFrames(Number(plan.tailFrames), Number(plan.sampleRate), Number(geometry.sampleRate)),
		);
	} catch {
		return false;
	}
	if (plan.outputFrames !== expectedOutputFrames) return false;
	let expected: Readonly<OfflineRenderOutputAdmissionPlan>;
	try {
		expected = planOfflineRenderOutputAdmission(
			geometry as unknown as OfflineRenderOutputGeometry,
			{ maximumUsefulBinaryBytes: Number(admission.maximumUsefulBinaryBytes) },
		);
	} catch {
		return false;
	}
	return admission.peakUsefulBinaryBytes === expected.peakUsefulBinaryWorkingSet.bytes
		&& admission.maximumUsefulBinaryBytes === expected.maximumUsefulBinaryBytes
		&& sameOutputAdmission(admission.outputAdmission, expected);
}

function canonicalGeometry(value: RecordValue): boolean {
	return safeInteger(value.channelCount, 1, 32)
		&& safeInteger(value.sampleRate, 1)
		&& safeInteger(value.contextFrames, 1)
		&& safeInteger(value.captureOffsetFrames, 0)
		&& safeInteger(value.requestedFrames, 1)
		&& value.contextFrames === addSafeOrNull(
			Number(value.captureOffsetFrames), Number(value.requestedFrames),
		);
}

function sameOutputAdmission(value: unknown, expected: Readonly<OfflineRenderOutputAdmissionPlan>): boolean {
	const candidate = recordValue(value);
	return Boolean(candidate
		&& sameKeys(candidate, OUTPUT_ADMISSION_FIELDS)
		&& GEOMETRY_FIELDS.every((field) => candidate[field] === expected[field])
		&& candidate.maximumUsefulBinaryBytes === expected.maximumUsefulBinaryBytes
		&& sameExactBytes(candidate.contextOutput, expected.contextOutput)
		&& sameExactBytes(candidate.cropOutput, expected.cropOutput)
		&& sameExactBytes(candidate.peakUsefulBinaryWorkingSet, expected.peakUsefulBinaryWorkingSet)
		&& candidate.browserHeapBytes === null
		&& candidate.processResidentSetBytes === null
		&& candidate.garbageCollectionHeadroomBytes === null);
}

function sameExactBytes(value: unknown, expected: Readonly<Record<string, unknown>>): boolean {
	const candidate = recordValue(value);
	return Boolean(candidate
		&& sameKeys(candidate, ['bytes', 'certainty', 'scope'])
		&& candidate.bytes === expected.bytes
		&& candidate.certainty === expected.certainty
		&& candidate.scope === expected.scope);
}

function canonicalMixOutput(value: unknown): boolean {
	const output = recordValue(value);
	const fileName = output?.fileName;
	return Boolean(output
		&& sameKeys(output, OUTPUT_FIELDS)
		&& output.kind === 'mix'
		&& output.trackId === null
		&& output.includeMaster === true
		&& output.respectMuteSolo === true
		&& typeof fileName === 'string'
		&& fileName.length > 0
		&& !fileName.includes('\0')
		&& !fileName.includes('/')
		&& !fileName.includes('\\'));
}

function canonicalThresholds(value: unknown): value is Readonly<{
	readonly outputBytes: number;
	readonly totalBytes: number;
}> {
	const thresholds = recordValue(value);
	return Boolean(thresholds
		&& sameKeys(thresholds, ['outputBytes', 'totalBytes'])
		&& (sameThresholds(thresholds, FAST_RENDER_THRESHOLDS.desktop)
			|| sameThresholds(thresholds, FAST_RENDER_THRESHOLDS.mobile)));
}

function sameThresholds(left: RecordValue, right: RecordValue): boolean {
	return left.outputBytes === right.outputBytes && left.totalBytes === right.totalBytes;
}

function recordValue(value: unknown): RecordValue | null {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value))
		? value as RecordValue
		: null;
}

function sameKeys(value: RecordValue, expected: readonly string[]): boolean {
	const keys = Reflect.ownKeys(value);
	return keys.length === expected.length && expected.every((field) => keys.includes(field));
}

function safeInteger(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): boolean {
	return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function addSafe(left: number, right: number): number {
	if (!safeInteger(left, 0) || !safeInteger(right, 0) || left > Number.MAX_SAFE_INTEGER - right) {
		throw new RangeError('Direct audio render frame arithmetic exceeds JavaScript safe integers.');
	}
	return left + right;
}

function addSafeOrNull(left: number, right: number): number | null {
	try { return addSafe(left, right); } catch { return null; }
}

function multiplySafe(...values: readonly number[]): number {
	let result = 1;
	for (const value of values) {
		if (!safeInteger(value, 0) || (value && result > Math.floor(Number.MAX_SAFE_INTEGER / value))) {
			throw new RangeError('Direct audio render PCM arithmetic exceeds JavaScript safe integers.');
		}
		result *= value;
	}
	return result;
}

function ceilScaledFrames(frames: number, outputRate: number, inputRate: number): number {
	if (!safeInteger(frames, 0) || !safeInteger(outputRate, 1) || !safeInteger(inputRate, 1)) {
		throw new RangeError('Direct audio render rate conversion geometry is invalid.');
	}
	const numerator = BigInt(frames) * BigInt(outputRate);
	const result = (numerator + BigInt(inputRate) - 1n) / BigInt(inputRate);
	if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError('Direct audio render rate conversion exceeds JavaScript safe integers.');
	}
	return Number(result);
}

function exactPreRollFrames(rangeStartFrame: number, sampleRate: number): number | null {
	if (!safeInteger(rangeStartFrame, 0) || !safeInteger(sampleRate, 1)) return null;
	const maximum = BigInt(sampleRate) * 10n;
	return Number(BigInt(rangeStartFrame) < maximum ? BigInt(rangeStartFrame) : maximum);
}

function sameJsonValue(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (Array.isArray(left) || Array.isArray(right)) {
		return Array.isArray(left) && Array.isArray(right)
			&& left.length === right.length
			&& left.every((item, index) => sameJsonValue(item, right[index]));
	}
	const leftRecord = recordValue(left);
	const rightRecord = recordValue(right);
	if (!leftRecord || !rightRecord) return false;
	const leftKeys = Reflect.ownKeys(leftRecord);
	const rightKeys = Reflect.ownKeys(rightRecord);
	return leftKeys.length === rightKeys.length
		&& rightKeys.every((key) => typeof key === 'string')
		&& leftKeys.every((key) => typeof key === 'string' && rightKeys.includes(key)
			&& sameJsonValue(leftRecord[key], rightRecord[key]));
}
