/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainField,
	readClosedDomainRecord,
} from './closed-domain-value.ts';
import { evaluateInterpolationCurveAtExactPosition } from './interpolation-curve.ts';
import {
	compareRationals,
	normalizeRational,
	subtractRationals,
	type Rational,
	type RationalInput,
	type RationalRate,
} from './timeline-time.ts';
import {
	normalizeVideoRetimeCurveV16,
	type VideoRetimeCurveV16,
} from './video-retime-v16.ts';
import { requireVideoTransitionTypeRegistrationV1 } from './video-transition-registry.ts';
import {
	normalizeVideoTransitionV1,
	type VideoTransitionV1,
} from './video-transition-v1.ts';

export interface CanonicalTransitionClipEdgeV1 {
	readonly clipId: string;
	readonly sourceId: string;
	readonly sequenceStartFrame: number;
	readonly sequenceFrameCount: number;
	readonly sequenceRate: RationalRate;
	readonly sourceInFrame: number;
	readonly sourceFrameCount: number;
	readonly sourceRate: RationalRate;
	readonly retimeMap: VideoRetimeCurveV16 | null;
}

export interface CanonicalTransitionClipEdgesV1 {
	readonly schemaVersion: 1;
	readonly sequenceId: string;
	readonly trackId: string;
	readonly outgoing: CanonicalTransitionClipEdgeV1;
	readonly incoming: CanonicalTransitionClipEdgeV1;
}

export interface VideoTransitionGeometryV1 {
	readonly transition: VideoTransitionV1;
	readonly edges: CanonicalTransitionClipEdgesV1;
	readonly overlapStartFrame: number;
	readonly overlapEndFrame: number;
	readonly durationFrames: number;
	readonly cutFrame: number;
}

export interface ResolvedVideoTransitionV1 extends VideoTransitionGeometryV1 {
	readonly localPosition: Rational;
	readonly progress: number;
	readonly outgoingWeight: number;
	readonly incomingWeight: number;
	readonly activeFrame: boolean;
}

const EDGES_FIELDS = Object.freeze([
	'schemaVersion', 'sequenceId', 'trackId', 'outgoing', 'incoming',
]);
const EDGE_FIELDS = Object.freeze([
	'clipId',
	'sourceId',
	'sequenceStartFrame',
	'sequenceFrameCount',
	'sequenceRate',
	'sourceInFrame',
	'sourceFrameCount',
	'sourceRate',
	'retimeMap',
]);
const RATE_FIELDS = Object.freeze(['num', 'den']);
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/** Snapshot the complete planner-owned two-clip boundary authority. */
export function normalizeCanonicalTransitionClipEdgesV1(
	value: unknown,
	name = 'canonical transition clip edges',
): CanonicalTransitionClipEdgesV1 {
	const input = readClosedDomainRecord(value, name, EDGES_FIELDS);
	if (field(input, 'schemaVersion', name) !== 1) {
		throw new RangeError(`${name}.schemaVersion must be 1.`);
	}
	const sequenceId = stableId(field(input, 'sequenceId', name), `${name}.sequenceId`);
	const trackId = stableId(field(input, 'trackId', name), `${name}.trackId`);
	const outgoing = normalizeClipEdge(field(input, 'outgoing', name), `${name}.outgoing`);
	const incoming = normalizeClipEdge(field(input, 'incoming', name), `${name}.incoming`);
	if (!sameRate(outgoing.sequenceRate, incoming.sequenceRate)) {
		throw new RangeError(`${name} participants must use the same exact sequence rate.`);
	}
	return Object.freeze({ schemaVersion: 1 as const, sequenceId, trackId, outgoing, incoming });
}

export function validateCanonicalTransitionClipEdgesV1(
	value: unknown,
	name = 'canonical transition clip edges',
): CanonicalTransitionClipEdgesV1 {
	return normalizeCanonicalTransitionClipEdgesV1(value, name);
}

/** Resolve and validate the exact proper-overlap geometry shared by commands and renderers. */
export function videoTransitionGeometryV1(
	transitionValue: unknown,
	edgesValue: unknown,
): VideoTransitionGeometryV1 {
	const transition = normalizeVideoTransitionV1(transitionValue);
	const edges = normalizeCanonicalTransitionClipEdgesV1(edgesValue);
	if (transition.outgoingClipId !== edges.outgoing.clipId
		|| transition.incomingClipId !== edges.incoming.clipId) {
		throw new RangeError('Video transition clip pair does not match its canonical edges.');
	}
	const outgoingStart = edges.outgoing.sequenceStartFrame;
	const overlapStartFrame = edges.incoming.sequenceStartFrame;
	const overlapEndFrame = safeAdd(
		outgoingStart,
		edges.outgoing.sequenceFrameCount,
		'video transition outgoing sequence end',
	);
	const incomingEnd = safeAdd(
		overlapStartFrame,
		edges.incoming.sequenceFrameCount,
		'video transition incoming sequence end',
	);
	if (!(outgoingStart < overlapStartFrame
		&& overlapStartFrame < overlapEndFrame
		&& overlapEndFrame < incomingEnd)) {
		throw new RangeError('Video transition geometry must be one proper two-clip overlap.');
	}
	const durationFrames = overlapEndFrame - overlapStartFrame;
	if (transition.durationFrames !== durationFrames) {
		throw new RangeError('Video transition duration must equal its exact proper overlap.');
	}
	const cutFrame = transition.alignment === 'start-at-cut'
		? overlapStartFrame
		: transition.alignment === 'end-at-cut'
			? overlapEndFrame
			: safeAdd(
				overlapStartFrame,
				Math.floor(durationFrames / 2),
				'video transition centered cut',
			);
	return Object.freeze({
		transition,
		edges,
		overlapStartFrame,
		overlapEndFrame,
		durationFrames,
		cutFrame,
	});
}

/** Evaluate the one registry-authorized renderer-neutral transition result. */
export function resolveVideoTransitionV1(
	transitionValue: unknown,
	edgesValue: unknown,
	sequencePositionValue: RationalInput,
): ResolvedVideoTransitionV1 {
	const geometry = videoTransitionGeometryV1(transitionValue, edgesValue);
	const registration = requireVideoTransitionTypeRegistrationV1(geometry.transition.type);
	if (registration.resolutionContract !== 'complementary-progress-v1') {
		throw new RangeError('The video transition resolution contract is unsupported.');
	}
	const sequencePosition = normalizeRational(sequencePositionValue);
	if (compareRationals(sequencePosition, geometry.overlapStartFrame) < 0
		|| compareRationals(sequencePosition, geometry.overlapEndFrame) > 0) {
		throw new RangeError('Video transition query lies outside its closed overlap description.');
	}
	const localPosition = subtractRationals(sequencePosition, geometry.overlapStartFrame);
	const progress = evaluateInterpolationCurveAtExactPosition(
		geometry.transition.curve,
		localPosition,
	);
	if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
		throw new RangeError('Video transition progress left the exact [0, 1] range.');
	}
	const outgoingWeight = 1 - progress;
	const incomingWeight = progress;
	if (!Number.isFinite(outgoingWeight) || outgoingWeight < 0 || outgoingWeight > 1) {
		throw new RangeError('Video transition complementary weights are invalid.');
	}
	return Object.freeze({
		...geometry,
		localPosition,
		progress,
		outgoingWeight,
		incomingWeight,
		activeFrame: compareRationals(sequencePosition, geometry.overlapEndFrame) < 0,
	});
}

function normalizeClipEdge(value: unknown, name: string): CanonicalTransitionClipEdgeV1 {
	const input = readClosedDomainRecord(value, name, EDGE_FIELDS);
	const clipId = stableId(field(input, 'clipId', name), `${name}.clipId`);
	const sourceId = stableId(field(input, 'sourceId', name), `${name}.sourceId`);
	const sequenceStartFrame = nonNegativeInteger(
		field(input, 'sequenceStartFrame', name), `${name}.sequenceStartFrame`,
	);
	const sequenceFrameCount = positiveInteger(
		field(input, 'sequenceFrameCount', name), `${name}.sequenceFrameCount`,
	);
	const sequenceRate = canonicalRate(field(input, 'sequenceRate', name), `${name}.sequenceRate`);
	const sourceInFrame = nonNegativeInteger(
		field(input, 'sourceInFrame', name), `${name}.sourceInFrame`,
	);
	const sourceFrameCount = positiveInteger(
		field(input, 'sourceFrameCount', name), `${name}.sourceFrameCount`,
	);
	const sourceRate = canonicalRate(field(input, 'sourceRate', name), `${name}.sourceRate`);
	safeAdd(sequenceStartFrame, sequenceFrameCount, `${name} sequence range`);
	safeAdd(sourceInFrame, sourceFrameCount, `${name} source range`);
	const retimeMap = normalizeVideoRetimeCurveV16(field(input, 'retimeMap', name), {
		sequenceFrameCount,
		sourceInFrame,
		sourceFrameCount,
	});
	return Object.freeze({
		clipId,
		sourceId,
		sequenceStartFrame,
		sequenceFrameCount,
		sequenceRate,
		sourceInFrame,
		sourceFrameCount,
		sourceRate,
		retimeMap,
	});
}

function canonicalRate(value: unknown, name: string): RationalRate {
	const input = readClosedDomainRecord(value, name, RATE_FIELDS);
	const num = field(input, 'num', name);
	const den = field(input, 'den', name);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den)
		|| Object.is(num, -0) || Object.is(den, -0) || Number(num) <= 0 || Number(den) <= 0) {
		throw new TypeError(`${name} must be a positive canonical exact rate.`);
	}
	const normalized = normalizeRational({ num: Number(num), den: Number(den) });
	if (normalized.num !== num || normalized.den !== den) {
		throw new TypeError(`${name} must be a reduced canonical exact rate.`);
	}
	return Object.freeze(normalized);
}

function sameRate(left: RationalRate, right: RationalRate): boolean {
	return left.num === right.num && left.den === right.den;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Object.is(value, -0) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer without negative zero.`);
	}
	return Number(value);
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Object.is(value, -0) || Number(value) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer without negative zero.`);
	}
	return Number(value);
}

function safeAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return result;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !STABLE_ID.test(value)) {
		throw new TypeError(`${name} must be a bounded canonical stable ID.`);
	}
	return value;
}

function field(
	record: Readonly<Record<string, unknown>>,
	key: string,
	name: string,
): unknown {
	return readClosedDomainField(record, key, name);
}
