/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from './closed-domain-value.ts';
import {
	compileInterpolationCurve,
	type CompiledInterpolationCurve,
} from './interpolation-curve.ts';
import { normalizeRational, type Rational } from './timeline-time.ts';

export const VIDEO_TRANSITION_LIMITS_V1 = Object.freeze({
	maximumTransitionsPerTrack: 16_384,
	maximumTransitionsPerProject: 100_000,
	maximumDurationFrames: 2_000_000,
	maximumCurveAnchors: 4_096,
});

export const VIDEO_TRANSITION_ALLOCATION_FIELD_V1 = 'videoTransitionAllocations' as const;

export type VideoTransitionAlignmentV1 =
	| 'start-at-cut'
	| 'center-on-cut'
	| 'end-at-cut';

export type VideoTransitionCurveV1 = CompiledInterpolationCurve;

export interface VideoTransitionV1 {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly type: string;
	readonly outgoingClipId: string;
	readonly incomingClipId: string;
	readonly alignment: VideoTransitionAlignmentV1;
	readonly durationFrames: number;
	readonly curve: VideoTransitionCurveV1;
}

export interface VideoTransitionAllocationV1 {
	readonly trackId: string;
	readonly outgoingClipId: string;
	readonly incomingClipId: string;
	readonly transitionId: string;
}

const TRANSITION_FIELDS = Object.freeze([
	'schemaVersion',
	'id',
	'type',
	'outgoingClipId',
	'incomingClipId',
	'alignment',
	'durationFrames',
	'curve',
]);
const CURVE_FIELDS = Object.freeze(['anchors', 'segments']);
const ANCHOR_FIELDS = Object.freeze(['position', 'value']);
const RATIONAL_FIELDS = Object.freeze(['num', 'den']);
const SIMPLE_SEGMENT_FIELDS = Object.freeze(['kind']);
const BEZIER_SEGMENT_FIELDS = Object.freeze(['kind', 'control1', 'control2']);
const ALLOCATION_FIELDS = Object.freeze([
	'trackId', 'outgoingClipId', 'incomingClipId', 'transitionId',
]);
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const TYPE_SLUG = /^[a-z][a-z0-9-]{0,63}$/u;

/** Normalize one structurally valid transition without consulting the maintained type registry. */
export function normalizeVideoTransitionV1(
	value: unknown,
	name = 'video transition',
): VideoTransitionV1 {
	const input = readClosedDomainRecord(value, name, TRANSITION_FIELDS);
	if (field(input, 'schemaVersion', name) !== 1) {
		throw new RangeError(`${name}.schemaVersion must be 1.`);
	}
	const id = stableId(field(input, 'id', name), `${name}.id`);
	const type = normalizeVideoTransitionTypeV1(field(input, 'type', name), `${name}.type`);
	const outgoingClipId = stableId(
		field(input, 'outgoingClipId', name), `${name}.outgoingClipId`,
	);
	const incomingClipId = stableId(
		field(input, 'incomingClipId', name), `${name}.incomingClipId`,
	);
	if (outgoingClipId === incomingClipId) {
		throw new RangeError(`${name} must reference two distinct clip IDs.`);
	}
	const alignment = transitionAlignment(field(input, 'alignment', name), `${name}.alignment`);
	const durationFrames = boundedPositiveInteger(
		field(input, 'durationFrames', name),
		VIDEO_TRANSITION_LIMITS_V1.maximumDurationFrames,
		`${name}.durationFrames`,
	);
	const curve = normalizeTransitionCurve(field(input, 'curve', name), durationFrames, `${name}.curve`);
	return Object.freeze({
		schemaVersion: 1 as const,
		id,
		type,
		outgoingClipId,
		incomingClipId,
		alignment,
		durationFrames,
		curve,
	});
}

/** Validate and detach one transition. Registry membership is intentionally not structural validity. */
export function validateVideoTransitionV1(
	value: unknown,
	name = 'video transition',
): VideoTransitionV1 {
	return normalizeVideoTransitionV1(value, name);
}

export function normalizeVideoTransitionTypeV1(
	value: unknown,
	name = 'video transition type',
): string {
	if (typeof value !== 'string' || !TYPE_SLUG.test(value)) {
		throw new TypeError(`${name} must be a canonical lowercase type slug.`);
	}
	return value;
}

/**
 * Normalize a track collection into the V22 canonical order: overlap start,
 * outgoing clip ID, incoming clip ID, then transition ID.
 */
export function normalizeVideoTransitionCollectionV1(
	value: unknown,
	overlapStartByTransitionId: ReadonlyMap<string, number>,
	name = 'videoTransitions',
): readonly VideoTransitionV1[] {
	const normalized = normalizeUnorderedCollection(value, overlapStartByTransitionId, name);
	return Object.freeze([...normalized].sort((left, right) => compareOrdered(left, right))
		.map(({ transition }) => transition));
}

/** Validate that persisted track order already matches the exact canonical order. */
export function validateVideoTransitionCollectionV1(
	value: unknown,
	overlapStartByTransitionId: ReadonlyMap<string, number>,
	name = 'videoTransitions',
): readonly VideoTransitionV1[] {
	const normalized = normalizeUnorderedCollection(value, overlapStartByTransitionId, name);
	const ordered = [...normalized].sort((left, right) => compareOrdered(left, right));
	for (let index = 0; index < normalized.length; index += 1) {
		if (normalized[index]?.transition.id !== ordered[index]?.transition.id) {
			throw new RangeError(`${name} must use canonical transition order.`);
		}
	}
	return Object.freeze(normalized.map(({ transition }) => transition));
}

/** Enforce the independent project ceiling before any project-wide traversal. */
export function assertVideoTransitionProjectLimitV1(
	trackCollections: readonly ReadonlyArray<unknown>[],
): void {
	if (!Array.isArray(trackCollections)) {
		throw new TypeError('Video transition track collections must be an array.');
	}
	let count = 0;
	for (const collection of trackCollections) {
		if (!Array.isArray(collection)) {
			throw new TypeError('Every video transition track collection must be an array.');
		}
		count += collection.length;
		if (!Number.isSafeInteger(count)
			|| count > VIDEO_TRANSITION_LIMITS_V1.maximumTransitionsPerProject) {
			throw new RangeError('A project may contain at most 100000 video transitions.');
		}
	}
}

/** Snapshot the exact replayable allocation carrier used by topology commands. */
export function normalizeVideoTransitionAllocationsV1(
	value: unknown,
	name = VIDEO_TRANSITION_ALLOCATION_FIELD_V1,
): readonly VideoTransitionAllocationV1[] {
	const values = readClosedDomainArray(
		value,
		name,
		0,
		VIDEO_TRANSITION_LIMITS_V1.maximumTransitionsPerProject,
	);
	const ids = new Set<string>();
	const pairs = new Set<string>();
	return Object.freeze(values.map((candidate, index) => {
		const itemName = `${name}[${String(index)}]`;
		const item = readClosedDomainRecord(candidate, itemName, ALLOCATION_FIELDS);
		const allocation = Object.freeze({
			trackId: stableId(field(item, 'trackId', itemName), `${itemName}.trackId`),
			outgoingClipId: stableId(
				field(item, 'outgoingClipId', itemName), `${itemName}.outgoingClipId`,
			),
			incomingClipId: stableId(
				field(item, 'incomingClipId', itemName), `${itemName}.incomingClipId`,
			),
			transitionId: stableId(
				field(item, 'transitionId', itemName), `${itemName}.transitionId`,
			),
		});
		if (allocation.outgoingClipId === allocation.incomingClipId) {
			throw new RangeError(`${itemName} must reference two distinct clips.`);
		}
		if (ids.has(allocation.transitionId)) {
			throw new RangeError(`Duplicate video transition allocation ID: ${allocation.transitionId}.`);
		}
		const pair = JSON.stringify([
			allocation.trackId, allocation.outgoingClipId, allocation.incomingClipId,
		]);
		if (pairs.has(pair)) throw new RangeError(`${name} contains a duplicate transition pair allocation.`);
		ids.add(allocation.transitionId);
		pairs.add(pair);
		return allocation;
	}));
}

interface OrderedTransition {
	readonly transition: VideoTransitionV1;
	readonly overlapStartFrame: number;
}

function normalizeUnorderedCollection(
	value: unknown,
	overlapStartByTransitionId: ReadonlyMap<string, number>,
	name: string,
): readonly OrderedTransition[] {
	if (!overlapStartByTransitionId || typeof overlapStartByTransitionId.get !== 'function') {
		throw new TypeError('Transition overlap starts must be provided by transition ID.');
	}
	const values = readClosedDomainArray(
		value,
		name,
		0,
		VIDEO_TRANSITION_LIMITS_V1.maximumTransitionsPerTrack,
	);
	const ids = new Set<string>();
	const pairs = new Set<string>();
	return values.map((candidate, index) => {
		const transition = normalizeVideoTransitionV1(candidate, `${name}[${String(index)}]`);
		if (ids.has(transition.id)) {
			throw new RangeError(`Duplicate video transition ID: ${transition.id}.`);
		}
		const pair = JSON.stringify([transition.outgoingClipId, transition.incomingClipId]);
		if (pairs.has(pair)) throw new RangeError(`${name} contains a duplicate transition clip pair.`);
		const overlapStartFrame = overlapStartByTransitionId.get(transition.id);
		if (!Number.isSafeInteger(overlapStartFrame) || Number(overlapStartFrame) < 0) {
			throw new ReferenceError(`Transition ${transition.id} has no canonical overlap start frame.`);
		}
		ids.add(transition.id);
		pairs.add(pair);
		return Object.freeze({ transition, overlapStartFrame: Number(overlapStartFrame) });
	});
}

function compareOrdered(left: OrderedTransition, right: OrderedTransition): number {
	return left.overlapStartFrame - right.overlapStartFrame
		|| compareStrings(left.transition.outgoingClipId, right.transition.outgoingClipId)
		|| compareStrings(left.transition.incomingClipId, right.transition.incomingClipId)
		|| compareStrings(left.transition.id, right.transition.id);
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeTransitionCurve(
	value: unknown,
	durationFrames: number,
	name: string,
): VideoTransitionCurveV1 {
	const input = readClosedDomainRecord(value, name, CURVE_FIELDS);
	const anchors = readClosedDomainArray(
		field(input, 'anchors', name),
		`${name}.anchors`,
		2,
		VIDEO_TRANSITION_LIMITS_V1.maximumCurveAnchors,
	);
	const segments = readClosedDomainArray(
		field(input, 'segments', name),
		`${name}.segments`,
		1,
		VIDEO_TRANSITION_LIMITS_V1.maximumCurveAnchors - 1,
	);
	if (anchors.length !== segments.length + 1) {
		throw new RangeError(`${name} requires exactly one fewer segment than anchors.`);
	}
	for (const [index, candidate] of anchors.entries()) {
		normalizeCurveAnchor(candidate, `${name}.anchors[${String(index)}]`);
	}
	for (const [index, candidate] of segments.entries()) {
		normalizeCurveSegment(candidate, `${name}.segments[${String(index)}]`);
	}
	const curve = compileInterpolationCurve({ anchors, segments });
	const first = curve.anchors[0];
	const last = curve.anchors.at(-1);
	if (!first || first.position.num !== 0 || first.position.den !== 1 || first.value !== 0) {
		throw new RangeError(`${name} must start at exact (0, 0).`);
	}
	if (!last || last.position.num !== durationFrames || last.position.den !== 1 || last.value !== 1) {
		throw new RangeError(`${name} must end at exact (durationFrames, 1).`);
	}
	return curve;
}

function normalizeCurveAnchor(value: unknown, name: string): void {
	const anchor = readClosedDomainRecord(value, name, ANCHOR_FIELDS);
	canonicalRational(field(anchor, 'position', name), `${name}.position`);
	unitValue(field(anchor, 'value', name), `${name}.value`);
}

function normalizeCurveSegment(value: unknown, name: string): void {
	const base = readClosedDomainRecord(value, name, BEZIER_SEGMENT_FIELDS, SIMPLE_SEGMENT_FIELDS);
	const kind = field(base, 'kind', name);
	if (kind === 'hold' || kind === 'linear' || kind === 'eased') {
		readClosedDomainRecord(value, name, SIMPLE_SEGMENT_FIELDS);
		return;
	}
	if (kind !== 'bezier') throw new RangeError(`${name}.kind is unsupported.`);
	const bezier = readClosedDomainRecord(value, name, BEZIER_SEGMENT_FIELDS);
	normalizeCurveAnchor(field(bezier, 'control1', name), `${name}.control1`);
	normalizeCurveAnchor(field(bezier, 'control2', name), `${name}.control2`);
}

function canonicalRational(value: unknown, name: string): Rational {
	const input = readClosedDomainRecord(value, name, RATIONAL_FIELDS);
	const num = field(input, 'num', name);
	const den = field(input, 'den', name);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || Object.is(num, -0)
		|| Object.is(den, -0) || Number(den) <= 0) {
		throw new TypeError(`${name} must be a canonical rational without negative zero.`);
	}
	const normalized = normalizeRational({ num: Number(num), den: Number(den) });
	if (normalized.num !== num || normalized.den !== den) {
		throw new TypeError(`${name} must be a reduced canonical rational.`);
	}
	return normalized;
}

function unitValue(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)
		|| value < 0 || value > 1) {
		throw new RangeError(`${name} must be a finite canonical value in [0, 1].`);
	}
	return value;
}

function transitionAlignment(value: unknown, name: string): VideoTransitionAlignmentV1 {
	if (value !== 'start-at-cut' && value !== 'center-on-cut' && value !== 'end-at-cut') {
		throw new RangeError(`${name} is unsupported.`);
	}
	return value;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !STABLE_ID.test(value)) {
		throw new TypeError(`${name} must be a bounded canonical stable ID.`);
	}
	return value;
}

function boundedPositiveInteger(value: unknown, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Object.is(value, -0) || Number(value) <= 0
		|| Number(value) > maximum) {
		throw new RangeError(`${name} must be a positive safe integer at most ${String(maximum)}.`);
	}
	return Number(value);
}

function field(
	record: Readonly<Record<string, unknown>>,
	key: string,
	name: string,
): unknown {
	return readClosedDomainField(record, key, name);
}
