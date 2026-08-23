/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	addRationals,
	compareRationals,
	divideRationals,
	evaluateBreakpointMap,
	multiplyRationals,
	roundRational,
	subtractRationals,
	validateBreakpointMap,
	type BreakpointMap,
	type Rational,
	type RationalInput,
} from './timeline-time.ts';
import {
	applyAudioGrooveTemplate,
	interpolateAudioWarpRational,
	normalizeAudioGrooveTemplate,
	normalizeAudioWarpGrid,
	normalizeAudioWarpRational,
	normalizeAudioWarpStrength,
	type AudioGrooveTemplateInput,
	type AudioWarpGridInput,
} from './audio-groove-template.ts';
import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from './closed-domain-value.ts';

export const MAXIMUM_AUDIO_WARP_POINTS = 4_096;
export const MAXIMUM_AUDIO_WARP_TRANSIENTS = MAXIMUM_AUDIO_WARP_POINTS - 2;

export interface AudioWarpPoint {
	readonly outer: Rational;
	readonly source: Rational;
	readonly mode: 'forward';
}

export interface AudioWarpMap {
	readonly feature: 'audio-warp';
	readonly points: readonly AudioWarpPoint[];
}

export interface AudioWarpTrimRange {
	readonly startOuter: RationalInput;
	readonly endOuter: RationalInput;
}

export interface AudioWarpQuantizeOptions {
	readonly grid: AudioWarpGridInput;
	readonly strength: RationalInput;
	readonly groove?: AudioGrooveTemplateInput;
	readonly grooveStrength?: RationalInput;
}

interface WorkingPoint extends AudioWarpPoint {
	readonly transient: boolean;
}

export function normalizeAudioWarpMap(value: unknown): Readonly<AudioWarpMap> {
	const record = readClosedDomainRecord(value, 'audio warp map', ['feature', 'points']);
	if (readClosedDomainField(record, 'feature', 'audio warp map') !== 'audio-warp') {
		throw new RangeError('Audio warp map feature must be audio-warp.');
	}
	const values = readClosedDomainArray(
		readClosedDomainField(record, 'points', 'audio warp map'),
		'audio warp map points',
		2,
		MAXIMUM_AUDIO_WARP_POINTS,
	);
	const points = Object.freeze(values.map((point, index) => normalizePoint(point, index)));
	const map = Object.freeze({ feature: 'audio-warp' as const, points });
	validateBreakpointMap(map as BreakpointMap);
	return map;
}

export function validateAudioWarpMap(value: unknown): true {
	normalizeAudioWarpMap(value);
	return true;
}

/** Evaluate outer clip-anchor units to absolute source samples through the shared wire evaluator. */
export function evaluateAudioWarpMap(mapValue: unknown, outer: RationalInput): Rational {
	const map = normalizeAudioWarpMap(mapValue);
	return evaluateBreakpointMap(map as BreakpointMap, normalizeAudioWarpRational(outer, 'audio warp outer position'));
}

/** Invert a valid audio map; strict monotonicity makes the inverse unique. */
export function evaluateAudioWarpMapAtSource(mapValue: unknown, source: RationalInput): Rational {
	const map = normalizeAudioWarpMap(mapValue);
	return evaluateNormalizedAtSource(map, normalizeAudioWarpRational(source, 'audio warp source position'));
}

/**
 * Trim one audio map without normalized-position drift. Boundary source anchors
 * are evaluated exactly, interior source anchors remain stable, and the new
 * clip-local outer domain is rebased to zero.
 */
export function trimAudioWarpMap(mapValue: unknown, rangeValue: AudioWarpTrimRange): Readonly<AudioWarpMap> {
	const map = normalizeAudioWarpMap(mapValue);
	const range = readClosedDomainRecord(rangeValue, 'audio warp trim range', ['startOuter', 'endOuter']);
	const start = normalizeAudioWarpRational(readClosedDomainField(range, 'startOuter', 'audio warp trim range'), 'audio warp trim start');
	const end = normalizeAudioWarpRational(readClosedDomainField(range, 'endOuter', 'audio warp trim range'), 'audio warp trim end');
	if (compareRationals(start, end) >= 0) throw new RangeError('Audio warp trim range must be positive.');
	const first = map.points[0];
	const last = map.points.at(-1)!;
	if (compareRationals(start, first.outer) < 0 || compareRationals(end, last.outer) > 0) {
		throw new RangeError('Audio warp trim range must remain within the map outer bounds.');
	}
	const points: AudioWarpPoint[] = [{
		outer: normalizeAudioWarpRational(0, 'audio warp trim origin'),
		source: evaluateBreakpointMap(map as BreakpointMap, start),
		mode: 'forward',
	}];
	for (const point of map.points) {
		if (compareRationals(point.outer, start) <= 0 || compareRationals(point.outer, end) >= 0) continue;
		points.push(Object.freeze({ ...point, outer: subtractRationals(point.outer, start) }));
	}
	points.push(Object.freeze({
		outer: subtractRationals(end, start),
		source: evaluateBreakpointMap(map as BreakpointMap, end),
		mode: 'forward',
	}));
	return normalizeAudioWarpMap({ feature: 'audio-warp', points });
}

/** Author transient anchors onto a grid while retaining endpoints and every unselected map anchor. */
export function quantizeAudioWarpTransients(
	mapValue: unknown,
	transientSourceValues: readonly RationalInput[],
	optionsValue: AudioWarpQuantizeOptions,
): Readonly<AudioWarpMap> {
	const map = normalizeAudioWarpMap(mapValue);
	const transients = normalizeTransientSources(transientSourceValues, map);
	const options = readClosedDomainRecord(
		optionsValue,
		'audio warp quantize options',
		['grid', 'strength', 'groove', 'grooveStrength'],
		['grid', 'strength'],
	);
	const grid = normalizeAudioWarpGrid(readClosedDomainField(options, 'grid', 'audio warp quantize options'));
	const strength = normalizeAudioWarpStrength(
		readClosedDomainField(options, 'strength', 'audio warp quantize options'),
		'audio warp quantize strength',
	);
	const grooveValue = Object.hasOwn(options, 'groove')
		? readClosedDomainField(options, 'groove', 'audio warp quantize options')
		: null;
	const groove = grooveValue == null ? null : normalizeAudioGrooveTemplate(grooveValue);
	if (!groove && Object.hasOwn(options, 'grooveStrength')) {
		throw new RangeError('Audio warp groove strength requires a groove template.');
	}
	const grooveStrength = groove
		? normalizeAudioWarpStrength(Object.hasOwn(options, 'grooveStrength')
			? readClosedDomainField(options, 'grooveStrength', 'audio warp quantize options')
			: 1, 'audio groove strength')
		: null;
	if (compareRationals(strength, 0) === 0 || !transients.length) return map;
	const merged = mergeTransientPoints(map, transients);
	const candidates = merged.map((point, index) => {
		if (!point.transient || index === 0 || index === merged.length - 1) return null;
		const relative = divideRationals(subtractRationals(point.outer, grid.origin), grid.interval);
		const gridIndex = roundRational(relative.num, relative.den, 'point');
		const target = groove
			? applyAudioGrooveTemplate(gridIndex, grid, groove, grooveStrength!)
			: addRationals(grid.origin, multiplyRationals(grid.interval, gridIndex));
		return interpolateAudioWarpRational(point.outer, target, strength);
	});
	// Quantizing each transient independently can collide neighbours that
	// share a nearest grid line, cross an unselected anchor, or land on an
	// endpoint. The command stays total: a transient whose move cannot keep
	// the map strictly increasing simply keeps its position. A move is safe
	// when it stays above the previous resolved outer and below the next
	// point's lowest possible outer, so one ordered pass resolves every point.
	let previousOuter = merged[0]!.outer;
	const points = merged.map((point, index) => {
		const candidate = candidates[index];
		if (candidate === null) {
			previousOuter = point.outer;
			return stablePoint(point);
		}
		const next = merged[index + 1]!;
		const nextCandidate = candidates[index + 1];
		const nextBound = nextCandidate !== null && compareRationals(nextCandidate, next.outer) < 0
			? nextCandidate
			: next.outer;
		if (compareRationals(candidate, previousOuter) <= 0 || compareRationals(candidate, nextBound) >= 0) {
			previousOuter = point.outer;
			return stablePoint(point);
		}
		previousOuter = candidate;
		return Object.freeze({ outer: candidate, source: point.source, mode: 'forward' as const });
	});
	return normalizeAudioWarpMap({ feature: 'audio-warp', points });
}

function normalizePoint(value: unknown, index: number): Readonly<AudioWarpPoint> {
	const name = `audio warp point ${String(index)}`;
	const record = readClosedDomainRecord(value, name, ['outer', 'source', 'mode']);
	if (readClosedDomainField(record, 'mode', name) !== 'forward') {
		throw new RangeError('Audio warp point mode must be forward.');
	}
	return Object.freeze({
		outer: normalizeAudioWarpRational(readClosedDomainField(record, 'outer', name), `${name} outer`),
		source: normalizeAudioWarpRational(readClosedDomainField(record, 'source', name), `${name} source`),
		mode: 'forward',
	});
}

function normalizeTransientSources(value: unknown, map: Readonly<AudioWarpMap>): readonly Rational[] {
	const values = readClosedDomainArray(value, 'audio warp transient sources', 0, MAXIMUM_AUDIO_WARP_TRANSIENTS);
	const sources = Object.freeze(values.map((source, index) => (
		normalizeAudioWarpRational(source, `audio warp transient source ${String(index)}`)
	)));
	for (let index = 1; index < sources.length; index += 1) {
		if (compareRationals(sources[index - 1], sources[index]) >= 0) {
			throw new RangeError('Audio warp transient sources must be strictly increasing.');
		}
	}
	const first = map.points[0].source;
	const last = map.points.at(-1)!.source;
	if (sources.some((source) => compareRationals(source, first) < 0 || compareRationals(source, last) > 0)) {
		throw new RangeError('Audio warp transient sources must remain within the map source bounds.');
	}
	return sources;
}

function mergeTransientPoints(map: Readonly<AudioWarpMap>, transients: readonly Rational[]): readonly WorkingPoint[] {
	const result: WorkingPoint[] = [];
	let pointIndex = 0;
	let transientIndex = 0;
	while (pointIndex < map.points.length || transientIndex < transients.length) {
		const point = map.points[pointIndex];
		const transient = transients[transientIndex];
		if (point && transient && compareRationals(point.source, transient) === 0) {
			result.push(Object.freeze({ ...point, transient: true }));
			pointIndex += 1;
			transientIndex += 1;
			continue;
		}
		if (!transient || (point && compareRationals(point.source, transient) < 0)) {
			result.push(Object.freeze({ ...point, transient: false }));
			pointIndex += 1;
			continue;
		}
		result.push(Object.freeze({
			outer: evaluateNormalizedAtSource(map, transient), source: transient, mode: 'forward', transient: true,
		}));
		transientIndex += 1;
	}
	if (result.length > MAXIMUM_AUDIO_WARP_POINTS) {
		throw new RangeError(`Audio warp quantization exceeds ${String(MAXIMUM_AUDIO_WARP_POINTS)} points.`);
	}
	return Object.freeze(result);
}

function evaluateNormalizedAtSource(map: Readonly<AudioWarpMap>, source: Rational): Rational {
	const inverse = Object.freeze({
		feature: 'audio-warp' as const,
		points: Object.freeze(map.points.map((point) => Object.freeze({
			outer: point.source, source: point.outer, mode: 'forward' as const,
		}))),
	});
	return evaluateBreakpointMap(inverse as BreakpointMap, source);
}

function stablePoint(point: WorkingPoint): Readonly<AudioWarpPoint> {
	return Object.freeze({ outer: point.outer, source: point.source, mode: 'forward' });
}
