/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUTOMATION_LANE_MAXIMUM_POINTS_V21,
	normalizeAutomationLaneV21,
	type AutomationLaneNormalizationOptionsV21,
	type AutomationLanePointV21,
	type AutomationLanePositionV21,
	type AutomationLaneV21,
} from './automation-lane-v21.ts';
import {
	thinAutomationLaneCaptureV21,
	type AutomationLaneThinningOptionsV21,
} from './automation-lane-thinning-v21.ts';
import type { InterpolationShape } from './interpolation-curve.ts';
import { compareRationals } from './timeline-time.ts';

export type AutomationWriteModeV21 = 'read' | 'trim' | 'touch' | 'latch' | 'write';
export type AutomationWritePhaseV21 = 'readback' | 'gesture' | 'after-gesture';
export type AutomationPlaybackOwnerV21 = 'lane' | 'trimmed-lane' | 'control';

export interface AutomationWriteModeDecisionV21 {
	readonly owner: AutomationPlaybackOwnerV21;
	readonly capture: boolean;
}

export interface AutomationWriteCaptureSampleV21 {
	readonly id: string;
	readonly position: AutomationLanePositionV21;
	readonly phase: AutomationWritePhaseV21;
	readonly laneValue: number;
	readonly controlValue: number;
	readonly trimDelta: number;
}

export interface AutomationWriteCommitResultV21 {
	readonly type: 'automation-write-commit-v21';
	readonly mode: AutomationWriteModeV21;
	readonly laneId: string;
	readonly changed: boolean;
	readonly capture: AutomationLaneV21 | null;
}

export interface AutomationWriteCommitOptionsV21
	extends AutomationLaneNormalizationOptionsV21, Pick<AutomationLaneThinningOptionsV21, 'maximumPoints'> {}

interface CapturedEntry {
	readonly point: Readonly<{ id: string; position: AutomationLanePositionV21; value: number }>;
	readonly changed: boolean;
}

const MODE_MATRIX: Readonly<Record<
	AutomationWriteModeV21,
	Readonly<Record<AutomationWritePhaseV21, AutomationWriteModeDecisionV21>>
>> = Object.freeze({
	read: decisions('lane', false, 'lane', false, 'lane', false),
	trim: decisions('lane', false, 'trimmed-lane', true, 'lane', false),
	touch: decisions('lane', false, 'control', true, 'lane', false),
	latch: decisions('lane', false, 'control', true, 'control', true),
	write: decisions('control', true, 'control', true, 'control', true),
});

/** Return the complete side-effect-free ownership/capture matrix entry. */
export function resolveAutomationWriteModeV21(
	mode: AutomationWriteModeV21,
	phase: AutomationWritePhaseV21,
): AutomationWriteModeDecisionV21 {
	if (!isMode(mode)) throw new RangeError('An automation mode must be read, trim, touch, latch, or write.');
	if (!isPhase(phase)) throw new RangeError('An automation phase must be readback, gesture, or after-gesture.');
	return MODE_MATRIX[mode][phase];
}

/**
 * Convert an arbitrary live-preview sample stream into at most one immutable
 * commit payload. Playback ownership is resolved by the same pure mode matrix.
 */
export function commitAutomationWriteModeV21(
	laneValue: AutomationLaneV21,
	mode: AutomationWriteModeV21,
	samplesValue: readonly AutomationWriteCaptureSampleV21[],
	options: AutomationWriteCommitOptionsV21 = {},
): AutomationWriteCommitResultV21 {
	const lane = normalizeAutomationLaneV21(laneValue, { descriptor: options.descriptor });
	if (!isMode(mode)) throw new RangeError('An automation mode must be read, trim, touch, latch, or write.');
	if (!Array.isArray(samplesValue)) throw new TypeError('Automation capture samples must be an array.');
	const captured: CapturedEntry[] = [];
	for (const [index, sample] of samplesValue.entries()) {
		if (!sample || typeof sample !== 'object') {
			throw new TypeError(`Automation capture sample ${String(index)} must be an object.`);
		}
		const decision = resolveAutomationWriteModeV21(mode, sample.phase);
		if (!decision.capture) continue;
		const laneSample = finite(sample.laneValue, `automation capture sample ${String(index)} laneValue`);
		const control = finite(sample.controlValue, `automation capture sample ${String(index)} controlValue`);
		const trimDelta = finite(sample.trimDelta, `automation capture sample ${String(index)} trimDelta`);
		const value = decision.owner === 'control'
			? control
			: finite(laneSample + trimDelta, `automation capture sample ${String(index)} trimmed value`);
		appendCaptured(captured, Object.freeze({
			point: Object.freeze({ id: sample.id, position: sample.position, value }),
			changed: value !== laneSample,
		}));
	}

	const changed = captured.some((entry) => entry.changed);
	const capture = changed ? mergeCaptureIntoLane(lane, captured, options) : null;
	return Object.freeze({
		type: 'automation-write-commit-v21',
		mode,
		laneId: lane.id,
		changed,
		capture,
	});
}

function appendCaptured(entries: CapturedEntry[], entry: CapturedEntry): void {
	const previous = entries.at(-1);
	if (previous) {
		const order = compareRationals(previous.point.position, entry.point.position);
		if (order > 0) {
			throw new RangeError(
				'Automation capture is non-monotonic after a backward seek or loop boundary.',
			);
		}
		if (order === 0) {
			entries[entries.length - 1] = entry;
			return;
		}
	}
	entries.push(entry);
}

function mergeCaptureIntoLane(
	lane: AutomationLaneV21,
	entries: readonly CapturedEntry[],
	options: AutomationWriteCommitOptionsV21,
): AutomationLaneV21 {
	const first = entries[0];
	const last = entries.at(-1);
	if (!first || !last) throw new RangeError('A changed automation commit requires captured points.');
	const prefixCount = lane.points.findIndex(({ position }) => compareRationals(position, first.point.position) >= 0);
	const normalizedPrefixCount = prefixCount < 0 ? lane.points.length : prefixCount;
	const suffixOffset = lane.points.findIndex(({ position }) => compareRationals(position, last.point.position) > 0);
	const normalizedSuffixOffset = suffixOffset < 0 ? lane.points.length : suffixOffset;
	const outsidePointCount = normalizedPrefixCount + lane.points.length - normalizedSuffixOffset;
	const maximumPoints = persistedMaximumPoints(options.maximumPoints);
	const capturePointCapacity = maximumPoints - outsidePointCount;
	if (capturePointCapacity < 1) {
		throw new RangeError('Automation capture cannot preserve outside anchors within the persisted point cap.');
	}
	const bridge = options.descriptor?.taper === 'discrete'
		? Object.freeze({ kind: 'hold' as const })
		: Object.freeze({ kind: 'linear' as const });
	const thinned = thinAutomationLaneCaptureV21({
		id: lane.id,
		address: lane.address,
		timebase: lane.timebase,
		points: entries.map(({ point }) => point),
		segments: entries.slice(0, -1).map(() => bridge),
	}, {
		descriptor: options.descriptor,
		maximumPoints: capturePointCapacity,
	});
	const points: Readonly<AutomationLanePointV21>[] = [
		...lane.points.slice(0, normalizedPrefixCount),
		...thinned.points,
		...lane.points.slice(normalizedSuffixOffset),
	];
	const segments: InterpolationShape[] = [
		...lane.segments.slice(0, Math.max(0, normalizedPrefixCount - 1)),
		...(normalizedPrefixCount > 0 ? [bridge] : []),
		...thinned.segments,
		...(normalizedSuffixOffset < lane.points.length ? [bridge] : []),
		...lane.segments.slice(normalizedSuffixOffset),
	];
	return normalizeAutomationLaneV21({
		id: lane.id,
		address: lane.address,
		timebase: lane.timebase,
		points,
		segments,
	}, { descriptor: options.descriptor });
}

function persistedMaximumPoints(value: unknown): number {
	const maximum = value === undefined ? AUTOMATION_LANE_MAXIMUM_POINTS_V21 : value;
	if (!Number.isSafeInteger(maximum) || Number(maximum) < 1
		|| Number(maximum) > AUTOMATION_LANE_MAXIMUM_POINTS_V21) {
		throw new RangeError(
			`maximumPoints must be from 1 through ${String(AUTOMATION_LANE_MAXIMUM_POINTS_V21)}.`,
		);
	}
	return Number(maximum);
}

function decisions(
	readbackOwner: AutomationPlaybackOwnerV21,
	readbackCapture: boolean,
	gestureOwner: AutomationPlaybackOwnerV21,
	gestureCapture: boolean,
	afterOwner: AutomationPlaybackOwnerV21,
	afterCapture: boolean,
): Readonly<Record<AutomationWritePhaseV21, AutomationWriteModeDecisionV21>> {
	return Object.freeze({
		readback: Object.freeze({ owner: readbackOwner, capture: readbackCapture }),
		gesture: Object.freeze({ owner: gestureOwner, capture: gestureCapture }),
		'after-gesture': Object.freeze({ owner: afterOwner, capture: afterCapture }),
	});
}

function isMode(value: unknown): value is AutomationWriteModeV21 {
	return value === 'read' || value === 'trim' || value === 'touch' || value === 'latch' || value === 'write';
}

function isPhase(value: unknown): value is AutomationWritePhaseV21 {
	return value === 'readback' || value === 'gesture' || value === 'after-gesture';
}

function finite(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
	return Object.is(value, -0) ? 0 : value;
}
