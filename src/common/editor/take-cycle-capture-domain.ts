/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	TAKE_COMP_MAXIMUM_ENTITIES,
	normalizeTakeCompGroupId,
	normalizeTakeId,
	normalizeTakeLaneId,
	type TakeCompGroupId,
	type TakeId,
	type TakeLaneId,
} from './take-comp-domain.ts';

export const TAKE_CYCLE_CAPTURE_MAXIMUM_SPANS = TAKE_COMP_MAXIMUM_ENTITIES;
export const TAKE_CYCLE_CAPTURE_MAXIMUM_PASSES = TAKE_COMP_MAXIMUM_ENTITIES;

export interface TakeCycleCaptureSpan {
	readonly startSample: number;
	readonly endSample: number;
}

export interface ExactTakeCycleCaptureRequest {
	readonly groupId: string;
	readonly laneId: string;
	readonly laneIds: readonly string[];
	readonly loopStartSample: number;
	readonly loopEndSample: number;
	readonly captureSpans: readonly TakeCycleCaptureSpan[];
	readonly takeIds: readonly string[];
	readonly interrupted: boolean;
}

export interface TakeCycleCaptureFragment {
	readonly spanIndex: number;
	readonly captureStartSample: number;
	readonly captureEndSample: number;
	readonly timelineStartSample: number;
	readonly timelineEndSample: number;
}

export interface TakeCycleCapturePass {
	readonly passIndex: number;
	readonly laneId: TakeLaneId;
	readonly takeId: TakeId;
	readonly captureStartSample: number;
	readonly captureEndSample: number;
	readonly timelineStartSample: number;
	readonly timelineEndSample: number;
	readonly complete: boolean;
	readonly interrupted: boolean;
	readonly fragments: readonly TakeCycleCaptureFragment[];
}

export interface ExactTakeCycleCapturePlan {
	readonly kind: 'exact-take-cycle-capture';
	readonly groupId: TakeCompGroupId;
	readonly laneId: TakeLaneId;
	readonly laneIds: readonly TakeLaneId[];
	readonly loopStartSample: number;
	readonly loopEndSample: number;
	readonly loopSampleCount: number;
	readonly captureStartSample: number;
	readonly captureEndSample: number;
	readonly interrupted: boolean;
	readonly passes: readonly TakeCycleCapturePass[];
}

type DataRecord = Readonly<Record<string, unknown>>;

/** Partition one unwrapped capture stream over a fixed integer loop grid. */
export function planExactTakeCycleCapture(value: unknown): ExactTakeCycleCapturePlan {
	const request = closedRecord(value, 'take cycle capture request', [
		'groupId', 'laneId', 'laneIds', 'loopStartSample', 'loopEndSample',
		'captureSpans', 'takeIds', 'interrupted',
	]);
	const groupId = normalizeTakeCompGroupId(request.groupId);
	const laneId = normalizeTakeLaneId(request.laneId);
	if (String(groupId) === String(laneId)) {
		throw new RangeError('Cycle capture groupId and laneId must be distinct.');
	}
	const loopStartSample = nonNegativeSafeInteger(request.loopStartSample, 'cycle loopStartSample');
	const loopEndSample = nonNegativeSafeInteger(request.loopEndSample, 'cycle loopEndSample');
	if (loopEndSample <= loopStartSample) throw new RangeError('Cycle capture loop extent must be positive.');
	const loopSampleCount = loopEndSample - loopStartSample;
	if (typeof request.interrupted !== 'boolean') {
		throw new TypeError('Cycle capture interrupted must be a boolean.');
	}

	const spanValues = denseArray(
		request.captureSpans,
		'cycle capture spans',
		TAKE_CYCLE_CAPTURE_MAXIMUM_SPANS,
	);
	if (spanValues.length === 0) throw new RangeError('Cycle capture requires at least one incoming capture span.');
	let expectedStart = loopStartSample;
	const captureSpans = spanValues.map((spanValue, spanIndex): TakeCycleCaptureSpan => {
		const span = closedRecord(spanValue, `cycle capture spans[${String(spanIndex)}]`, [
			'startSample', 'endSample',
		]);
		const startSample = nonNegativeSafeInteger(span.startSample, 'cycle capture span startSample');
		const endSample = nonNegativeSafeInteger(span.endSample, 'cycle capture span endSample');
		if (spanIndex === 0 && startSample !== loopStartSample) {
			throw new RangeError('Cycle capture spans must begin at loopStartSample.');
		}
		if (startSample !== expectedStart) throw new RangeError('Cycle capture spans must be contiguous.');
		if (endSample <= startSample) throw new RangeError('Cycle capture spans must have positive extent.');
		expectedStart = endSample;
		return Object.freeze({ startSample, endSample });
	});
	const captureEndSample = captureSpans.at(-1)!.endSample;
	const capturedSampleCount = captureEndSample - loopStartSample;
	const passCountBigInt = (
		BigInt(capturedSampleCount) + BigInt(loopSampleCount) - 1n
	) / BigInt(loopSampleCount);
	if (passCountBigInt > BigInt(TAKE_CYCLE_CAPTURE_MAXIMUM_PASSES)) {
		throw new RangeError(`Cycle capture exceeds ${String(TAKE_CYCLE_CAPTURE_MAXIMUM_PASSES)} passes.`);
	}
	const passCount = Number(passCountBigInt);
	const hasPartialPass = capturedSampleCount % loopSampleCount !== 0;
	if (hasPartialPass && request.interrupted !== true) {
		throw new RangeError('A partial cycle pass requires interrupted=true.');
	}

	const takeIdValues = denseArray(
		request.takeIds,
		'cycle capture takeIds',
		TAKE_CYCLE_CAPTURE_MAXIMUM_PASSES,
	);
	if (takeIdValues.length !== passCount) {
		throw new RangeError(`Cycle capture requires exactly ${String(passCount)} caller-supplied take IDs.`);
	}
	const laneIdValues = denseArray(
		request.laneIds,
		'cycle capture laneIds',
		TAKE_CYCLE_CAPTURE_MAXIMUM_PASSES,
	);
	if (laneIdValues.length !== passCount) {
		throw new RangeError(`Cycle capture requires exactly ${String(passCount)} caller-supplied lane IDs.`);
	}
	const laneIdSet = new Set<string>();
	const laneIds = laneIdValues.map((laneIdValue): TakeLaneId => {
		const passLaneId = normalizeTakeLaneId(laneIdValue);
		if (laneIdSet.has(passLaneId)) throw new RangeError(`Duplicate cycle lane ID ${passLaneId}.`);
		if (String(passLaneId) === String(groupId)) {
			throw new RangeError(`Cycle lane ID ${passLaneId} collides with cycle group identity.`);
		}
		laneIdSet.add(passLaneId);
		return passLaneId;
	});
	if (laneIds[0] !== laneId) throw new RangeError('The first cycle lane ID must equal laneId.');
	const takeIdSet = new Set<string>();
	const takeIds = takeIdValues.map((takeIdValue): TakeId => {
		const takeId = normalizeTakeId(takeIdValue);
		if (takeIdSet.has(takeId)) throw new RangeError(`Duplicate cycle take ID ${takeId}.`);
		if (String(takeId) === String(groupId) || laneIdSet.has(takeId)) {
			throw new RangeError(`Cycle take ID ${takeId} collides with cycle group or lane identity.`);
		}
		takeIdSet.add(takeId);
		return takeId;
	});

	let firstPossibleSpanIndex = 0;
	const passes: TakeCycleCapturePass[] = [];
	for (let passIndex = 0; passIndex < passCount; passIndex += 1) {
		const captureStartSample = exactPassBoundary(
			loopStartSample, loopSampleCount, passIndex, captureEndSample,
		);
		const capturePassLimit = exactPassBoundary(
			loopStartSample, loopSampleCount, passIndex + 1, captureEndSample,
		);
		const passEndSample = Math.min(captureEndSample, capturePassLimit);
		while (captureSpans[firstPossibleSpanIndex]?.endSample <= captureStartSample) {
			firstPossibleSpanIndex += 1;
		}
		const fragments: TakeCycleCaptureFragment[] = [];
		for (let spanIndex = firstPossibleSpanIndex; spanIndex < captureSpans.length; spanIndex += 1) {
			const span = captureSpans[spanIndex]!;
			if (span.startSample >= passEndSample) break;
			const fragmentStart = Math.max(span.startSample, captureStartSample);
			const fragmentEnd = Math.min(span.endSample, passEndSample);
			if (fragmentStart >= fragmentEnd) continue;
			fragments.push(Object.freeze({
				spanIndex,
				captureStartSample: fragmentStart,
				captureEndSample: fragmentEnd,
				timelineStartSample: loopStartSample + (fragmentStart - captureStartSample),
				timelineEndSample: loopStartSample + (fragmentEnd - captureStartSample),
			}));
		}
		const timelineEndSample = loopStartSample + (passEndSample - captureStartSample);
		const complete = timelineEndSample === loopEndSample;
		passes.push(Object.freeze({
			passIndex,
			laneId: laneIds[passIndex]!,
			takeId: takeIds[passIndex]!,
			captureStartSample,
			captureEndSample: passEndSample,
			timelineStartSample: loopStartSample,
			timelineEndSample,
			complete,
			interrupted: !complete && request.interrupted === true,
			fragments: Object.freeze(fragments),
		}));
	}

	return Object.freeze({
		kind: 'exact-take-cycle-capture', groupId, laneId, laneIds: Object.freeze(laneIds),
		loopStartSample, loopEndSample, loopSampleCount,
		captureStartSample: loopStartSample, captureEndSample,
		interrupted: request.interrupted,
		passes: Object.freeze(passes),
	});
}

function exactPassBoundary(
	loopStartSample: number,
	loopSampleCount: number,
	passIndex: number,
	captureEndSample: number,
): number {
	const boundary = BigInt(loopStartSample) + BigInt(loopSampleCount) * BigInt(passIndex);
	return boundary > BigInt(captureEndSample) ? captureEndSample : Number(boundary);
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function closedRecord(value: unknown, name: string, requiredKeys: readonly string[]): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a closed data record.`);
	}
	const record = value as Record<PropertyKey, unknown>;
	const keys = Reflect.ownKeys(record);
	const allowed = new Set(requiredKeys);
	if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))
		|| requiredKeys.some((key) => !keys.includes(key))) {
		throw new TypeError(`${name} has an invalid closed shape.`);
	}
	const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${String(key)} must be an enumerable data property.`);
		}
		result[key] = descriptor.value;
	}
	return Object.freeze(result);
}

function denseArray(value: unknown, name: string, maximumLength: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`${name} must be a standard dense data array.`);
	}
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
	const length = lengthDescriptor && Object.hasOwn(lengthDescriptor, 'value')
		? lengthDescriptor.value : null;
	if (!Number.isSafeInteger(length) || Number(length) < 0 || Number(length) > maximumLength) {
		throw new RangeError(`${name} exceeds its ${String(maximumLength)} item limit.`);
	}
	if (Reflect.ownKeys(value).length !== Number(length) + 1) {
		throw new TypeError(`${name} must be dense and carry no extra keys.`);
	}
	const result: unknown[] = [];
	for (let index = 0; index < Number(length); index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} must contain only enumerable data items.`);
		}
		result.push(descriptor.value);
	}
	return Object.freeze(result);
}
