/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoRetimeCurveSegment } from './video-retime-curve.ts';
import {
	createVideoRetimeRuntimeMapper,
	type VideoRetimeRuntimePartition,
} from './video-retime-runtime-mapping.ts';
import {
	boundVideoSourceTimingViewInfo,
	videoSourceFrameTime,
	type BoundVideoSourceTimingView,
	type ExactSourcePosition,
	type ExactSourceTime,
} from './video-source-timing-view.ts';

export interface VideoRetimeFrameDescriptor {
	readonly outerCell: number;
	readonly segmentIndex: number;
	readonly mode: VideoRetimeCurveSegment['mode'];
	readonly sourceFrame: ExactSourcePosition;
	readonly sourceTime: ExactSourceTime;
	readonly drawableSourceFrame: number;
	readonly drawableSourceStartTime: ExactSourceTime;
	readonly drawableSourceEndTime: ExactSourceTime;
}

export interface VideoRetimeTerminalBoundary {
	readonly outerBoundary: number;
	readonly sourceFrame: ExactSourcePosition;
	readonly sourceTime: ExactSourceTime;
}

export interface VideoRetimeFrameDispatcher {
	readonly outerFrameCount: number;
	readonly terminal: VideoRetimeTerminalBoundary;
	readonly dispatchOuterCell: (outerCell: number) => VideoRetimeFrameDescriptor;
}

/** Bind one persisted retimed clip to one authenticated source timing snapshot. */
export function createVideoRetimeFrameDispatcher(
	clipValue: unknown,
	timing: BoundVideoSourceTimingView,
): VideoRetimeFrameDispatcher {
	const timingInfo = boundVideoSourceTimingViewInfo(timing);
	const clip = record(clipValue, 'video retime clip');
	const sourceId = nonEmptyString(
		dataProperty(clip, 'sourceId', 'video retime clip'),
		'video retime clip.sourceId',
	);
	if (sourceId !== timingInfo.sourceId) {
		throw new RangeError('The video retime clip source must match its bound timing source.');
	}

	const mapper = createVideoRetimeRuntimeMapper(clipValue);
	if (mapper.sourceOutFrame > timingInfo.frameCount) {
		throw new RangeError('The video retime clip source binding exceeds its bound timing frame count.');
	}
	const terminalSourceFrame = mapper.mapOuterFrame(mapper.outerFrameCount);
	const terminal = Object.freeze({
		outerBoundary: mapper.outerFrameCount,
		sourceFrame: terminalSourceFrame,
		sourceTime: videoSourceFrameTime(timing, terminalSourceFrame),
	});
	let cachedOuterCell: number | null = null;
	let cachedDescriptor: VideoRetimeFrameDescriptor | null = null;

	const dispatchOuterCell = (outerCell: number): VideoRetimeFrameDescriptor => {
		assertDrawableOuterCell(outerCell, mapper.outerFrameCount);
		if (outerCell === cachedOuterCell && cachedDescriptor !== null) return cachedDescriptor;
		const partition = partitionForOuterCell(mapper.partitions, outerCell);
		const sourceFrame = mapper.mapOuterFrame(outerCell);
		const drawableSourceFrame = drawableFrameForPosition(
			sourceFrame,
			partition.mode,
			mapper.sourceInFrame,
			mapper.sourceOutFrame,
		);
		const descriptor = Object.freeze({
			outerCell,
			segmentIndex: partition.segmentIndex,
			mode: partition.mode,
			sourceFrame,
			sourceTime: videoSourceFrameTime(timing, sourceFrame),
			drawableSourceFrame,
			drawableSourceStartTime: videoSourceFrameTime(timing, integerPosition(drawableSourceFrame)),
			drawableSourceEndTime: videoSourceFrameTime(timing, integerPosition(drawableSourceFrame + 1)),
		});
		cachedOuterCell = outerCell;
		cachedDescriptor = descriptor;
		return descriptor;
	};

	return Object.freeze({
		outerFrameCount: mapper.outerFrameCount,
		terminal,
		dispatchOuterCell,
	});
}

function partitionForOuterCell(
	partitions: readonly VideoRetimeRuntimePartition[],
	outerCell: number,
): VideoRetimeRuntimePartition {
	let lower = 0;
	let upper = partitions.length;
	while (lower + 1 < upper) {
		const middle = lower + Math.floor((upper - lower) / 2);
		if (required(partitions[middle]).startOuterFrame <= outerCell) lower = middle;
		else upper = middle;
	}
	return required(partitions[lower]);
}

function drawableFrameForPosition(
	position: ExactSourcePosition,
	mode: VideoRetimeCurveSegment['mode'],
	sourceInFrame: number,
	sourceOutFrame: number,
): number {
	const owned = mode === 'constant-reverse' || mode === 'ramp-reverse'
		? ceiling(position) - 1n
		: floor(position);
	const lower = BigInt(sourceInFrame);
	const upper = BigInt(sourceOutFrame - 1);
	return Number(owned < lower ? lower : owned > upper ? upper : owned);
}

function floor(position: ExactSourcePosition): bigint {
	const quotient = position.numerator / position.denominator;
	return position.numerator % position.denominator < 0n ? quotient - 1n : quotient;
}

function ceiling(position: ExactSourcePosition): bigint {
	const quotient = position.numerator / position.denominator;
	return position.numerator % position.denominator > 0n ? quotient + 1n : quotient;
}

function integerPosition(frame: number): ExactSourcePosition {
	return Object.freeze({ numerator: BigInt(frame), denominator: 1n });
}

function assertDrawableOuterCell(value: unknown, outerFrameCount: number): asserts value is number {
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) >= outerFrameCount) {
		throw new RangeError('A drawable video retime outer cell must be a safe integer inside its cell domain.');
	}
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function dataProperty(value: Record<string, unknown>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property, not an accessor.`);
	}
	return descriptor.value;
}

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function required<Value>(value: Value | null | undefined): Value {
	if (value == null) throw new RangeError('Expected a bounded video retime partition.');
	return value;
}
