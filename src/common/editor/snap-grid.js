import {
	beatToSampleFrame,
	divideRationals,
	multiplyRationals,
	normalizeRational,
	roundRational,
} from './timeline-time.ts';
import { sampleFrameToBeat } from './timeline-tempo-inverse.ts';
import { barStartBeat, surroundingBarBoundaries } from './musical-grid.ts';

const MUSICAL_DENOMINATORS = Object.freeze([2, 4, 8, 16, 32, 64, 128]);
const MODE_ALIASES = Object.freeze(new Map([
	['nearest', 'nearest'],
	['round', 'nearest'],
	['previous', 'previous'],
	['floor', 'previous'],
	['left', 'previous'],
	['next', 'next'],
	['ceil', 'next'],
	['right', 'next'],
]));

const definitions = [
	definition(0, 'bar', 'musical', { bar: true, triplets: false }),
	...MUSICAL_DENOMINATORS.map((denominator, index) => definition(index + 1, `1/${denominator}`, 'musical', { denominator, triplets: true })),
	definition(8, 'seconds', 'time', { frequencyNumerator: 1, frequencyDenominator: 1 }),
	definition(9, 'deciseconds', 'time', { frequencyNumerator: 10, frequencyDenominator: 1 }),
	definition(10, 'centiseconds', 'time', { frequencyNumerator: 100, frequencyDenominator: 1 }),
	definition(11, 'milliseconds', 'time', { frequencyNumerator: 1_000, frequencyDenominator: 1 }),
	definition(12, 'samples', 'samples'),
	definition(13, 'video-24', 'video', { frequencyNumerator: 24, frequencyDenominator: 1 }),
	definition(14, 'video-ntsc', 'video', { frequencyNumerator: 30_000, frequencyDenominator: 1_001 }),
	definition(15, 'video-ntsc-drop', 'video', { frequencyNumerator: 30_000, frequencyDenominator: 1_001, dropFrame: true }),
	definition(16, 'video-pal', 'video', { frequencyNumerator: 25, frequencyDenominator: 1 }),
	definition(17, 'cdda', 'cdda', { frequencyNumerator: 75, frequencyDenominator: 1 }),
];

export const AUDIO_EDITOR_SNAP_GRIDS = Object.freeze(definitions);
export const AUDIO_EDITOR_SNAP_GRID_IDS = Object.freeze(definitions.map(({ id }) => id));
export const AUDIO_EDITOR_SNAP_UPSTREAM_MIN = 0;
export const AUDIO_EDITOR_SNAP_UPSTREAM_MAX = 17;

const BY_ID = new Map(definitions.map((entry) => [entry.id, entry]));
const BY_TYPE = new Map(definitions.map((entry) => [entry.upstreamType, entry]));
const ALIASES = new Map([
	['bars', 'bar'],
	['beats', '1/4'],
	['second', 'seconds'],
	['tenths', 'deciseconds'],
	['hundredths', 'centiseconds'],
	['thousandths', 'milliseconds'],
	['sample', 'samples'],
	['frames', 'video-24'],
	['film', 'video-24'],
	['film-24', 'video-24'],
	['24fps', 'video-24'],
	['ntsc', 'video-ntsc'],
	['ntsc-29.97', 'video-ntsc'],
	['29.97fps', 'video-ntsc'],
	['ntsc-drop', 'video-ntsc-drop'],
	['pal', 'video-pal'],
	['pal-25', 'video-pal'],
	['25fps', 'video-pal'],
	['cdda-75', 'cdda'],
	['75fps', 'cdda'],
]);

for (const denominator of MUSICAL_DENOMINATORS) {
	ALIASES.set(`1/${denominator}-triplet`, `1/${denominator}`);
	ALIASES.set(`1/${denominator}t`, `1/${denominator}`);
}

/** Resolve a stable ID, pinned upstream numeric type, alias, or snap object. */
export function audioEditorSnapGrid(value = 'seconds') {
	if (value && typeof value === 'object') {
		if (value.upstreamType != null) return audioEditorSnapGrid(value.upstreamType);
		const stableValue = value.division || value.unit || value.id;
		if (stableValue != null) return audioEditorSnapGrid(stableValue);
		if (value.type != null && (typeof value.type === 'number' || /^\d+$/.test(String(value.type)))) {
			return audioEditorSnapGrid(value.type);
		}
		if (value.opaqueType != null && Number(value.opaqueType) >= AUDIO_EDITOR_SNAP_UPSTREAM_MIN) {
			const byOpaqueType = BY_TYPE.get(Number(value.opaqueType));
			if (byOpaqueType) return byOpaqueType;
		}
		value = undefined;
	}
	if (typeof value === 'number' || /^\d+$/.test(String(value ?? '').trim())) {
		const type = Number(value);
		const result = BY_TYPE.get(type);
		if (!result) throw new RangeError(`Unsupported Audacity snap type: ${value}.`);
		return result;
	}
	let id = String(value ?? '').trim().toLowerCase();
	if (!id) id = 'seconds';
	const tripletSuffix = /(?:-triplet|t)$/.test(id);
	id = ALIASES.get(id) || id;
	const result = BY_ID.get(id);
	if (!result) throw new RangeError(`Unsupported snap grid: ${value}.`);
	return tripletSuffix && result.triplets ? Object.freeze({ ...result, impliedTriplets: true }) : result;
}

/**
 * Normalize project snap settings while preserving whether snapping is enabled.
 * This accepts both V2 stable IDs and the pinned Audacity numeric profile.
 */
export function normalizeAudioEditorSnapSettings(value = {}) {
	const grid = audioEditorSnapGrid(value);
	const triplets = Boolean(value?.triplets || value?.isSnapTriplets || grid.impliedTriplets) && Boolean(grid.triplets);
	return Object.freeze({
		enabled: Boolean(value?.enabled),
		unit: grid.id,
		division: grid.id,
		mode: normalizeMode(value?.mode || 'nearest'),
		triplets,
		opaqueType: grid.upstreamType,
	});
}

/** Return the ideal (possibly fractional) number of project frames per grid cell. */
export function audioEditorSnapStepFrames(gridValue, context = {}) {
	const step = audioEditorSnapStepRational(gridValue, context);
	return step.num / step.den;
}

function audioEditorSnapStepRational(gridValue, context = {}) {
	const grid = audioEditorSnapGrid(gridValue);
	const sampleRate = projectSampleRate(context);
	if (grid.category === 'samples') return normalizeRational(1);
	if (grid.category === 'time' || grid.category === 'video' || grid.category === 'cdda') {
		return normalizeRational({
			num: sampleRate * grid.frequencyDenominator,
			den: grid.frequencyNumerator,
		});
	}
	const { bpm, numerator, denominator } = projectTempo(context);
	const quarterFrames = divideRationals(multiplyRationals(sampleRate, 60), normalizeRational(bpm));
	if (grid.bar) {
		return divideRationals(multiplyRationals(quarterFrames, 4 * numerator), denominator);
	}
	const triplets = requestedTriplets(gridValue, context, grid);
	const division = triplets ? 3 * (grid.denominator / 2) : grid.denominator;
	return divideRationals(multiplyRationals(quarterFrames, 4), division);
}

/**
 * Snap an integer timeline frame to the selected grid without cumulative drift.
 * Every result is calculated from the project origin, including rational video
 * rates such as 30000/1001 and grids that do not divide the project rate.
 */
export function snapAudioEditorProjectFrame(frame, gridValue, context = {}) {
	const inputFrame = safeInteger(frame, 'frame');
	const mode = normalizeMode(context.mode || (typeof gridValue === 'object' ? gridValue.mode : null) || 'nearest');
	const grid = audioEditorSnapGrid(gridValue);
	if (grid.category === 'musical' && projectTempoMap(context) && inputFrame >= 0) {
		return boundedFrame(snapMusicalFrame(inputFrame, gridValue, context, grid, mode), context);
	}
	const step = audioEditorSnapStepRational(gridValue, context);
	const stepNumerator = BigInt(step.num);
	const stepDenominator = BigInt(step.den);
	const lineAt = (index) => roundRational(index * stepNumerator, stepDenominator, 'point');
	let gridIndex = BigInt(roundRational(
		BigInt(inputFrame) * stepDenominator,
		stepNumerator,
		mode === 'nearest' ? 'point' : 'directional',
		mode === 'nearest' ? undefined : mode,
	));
	// A grid line only ever exists as a whole frame, so the directional modes have
	// to compare against the rounded lines rather than the exact ratio. A line
	// that rounded down otherwise reads as belonging to the cell before it, and
	// snapping an already-snapped frame walks a whole cell. Rounding moves a line
	// by at most half a frame, so one step of correction is always enough.
	if (mode === 'previous') {
		if (gridIndex > 0n && lineAt(gridIndex) > inputFrame) gridIndex -= 1n;
		else if (lineAt(gridIndex + 1n) <= inputFrame) gridIndex += 1n;
	} else if (mode === 'next') {
		if (lineAt(gridIndex) < inputFrame) gridIndex += 1n;
		else if (gridIndex > 0n && lineAt(gridIndex - 1n) >= inputFrame) gridIndex -= 1n;
	}
	const result = lineAt(gridIndex);
	if (!Number.isSafeInteger(result)) throw new RangeError('The snapped frame is outside the safe integer range.');
	return boundedFrame(result, context);
}

/** Apply a project's enabled snap setting; disabled projects retain the frame. */
export function snapAudioEditorFrameWithProject(frame, project, overrides = {}) {
	if (!project || typeof project !== 'object') throw new TypeError('project must be an object.');
	const inputFrame = safeInteger(frame, 'frame');
	const settings = normalizeAudioEditorSnapSettings(project.snap || {});
	if (!settings.enabled && !overrides.force) return inputFrame;
	return snapAudioEditorProjectFrame(inputFrame, { ...settings, triplets: settings.triplets }, {
		...project,
		...overrides,
		mode: overrides.mode || settings.mode,
		triplets: overrides.triplets ?? settings.triplets,
	});
}

/** Move exactly one grid cell from the snapped position. */
export function stepAudioEditorSnappedFrame(frame, direction, gridValue, context = {}) {
	const sign = direction === 'left' || direction === 'previous' || direction === -1 ? -1
		: direction === 'right' || direction === 'next' || direction === 1 ? 1
			: 0;
	if (!sign) throw new RangeError(`Unsupported snap direction: ${direction}.`);
	const inputFrame = safeInteger(frame, 'frame');
	const grid = audioEditorSnapGrid(gridValue);
	if (grid.category === 'musical' && projectTempoMap(context) && inputFrame >= 0) {
		return boundedFrame(stepMusicalFrame(inputFrame, sign, gridValue, context, grid), context);
	}
	const step = audioEditorSnapStepRational(gridValue, context);
	const gridIndex = roundRational(
		BigInt(inputFrame) * BigInt(step.den),
		BigInt(step.num),
		'point',
	) + sign;
	const result = roundRational(BigInt(gridIndex) * BigInt(step.num), BigInt(step.den), 'point');
	if (!Number.isSafeInteger(result)) throw new RangeError('The stepped frame is outside the safe integer range.');
	return boundedFrame(result, context);
}

function snapMusicalFrame(frame, gridValue, context, grid, mode) {
	const sampleRate = projectSampleRate(context);
	const tempoMap = projectTempoMap(context);
	const beat = sampleFrameToBeat(frame, tempoMap, sampleRate);
	if (!grid.bar) {
		const unit = musicalDivision(gridValue, context, grid);
		const lineAt = (index) => beatToSampleFrame(multiplyRationals(unit, index), tempoMap, sampleRate, 'point');
		let index = roundRational(
			BigInt(beat.num) * BigInt(unit.den),
			BigInt(beat.den) * BigInt(unit.num),
			mode === 'nearest' ? 'point' : 'directional',
			mode === 'nearest' ? undefined : mode,
		);
		// A line exists only as a whole frame, and reading that frame back gives a
		// beat just short of the boundary, so the directional modes have to compare
		// rounded frames. One step of correction always suffices.
		if (mode === 'previous') {
			if (index > 0 && lineAt(index) > frame) index -= 1;
			else if (lineAt(index + 1) <= frame) index += 1;
		} else if (mode === 'next') {
			if (lineAt(index) < frame) index += 1;
			else if (index > 0 && lineAt(index - 1) >= frame) index -= 1;
		}
		return lineAt(index);
	}
	const boundaries = surroundingBarBoundaries(beat, projectSignatureMap(context));
	const lowerFrame = beatToSampleFrame(boundaries.lowerBeat, tempoMap, sampleRate, 'point');
	const upperFrame = beatToSampleFrame(boundaries.upperBeat, tempoMap, sampleRate, 'point');
	// The bar this frame reports can be the one before the line it already sits
	// on, so each direction takes the neighbouring boundary when that boundary is
	// the one on its own side of the frame.
	if (mode === 'previous') return upperFrame <= frame ? upperFrame : lowerFrame;
	if (mode === 'next') return lowerFrame >= frame ? lowerFrame : upperFrame;
	return frame - lowerFrame < upperFrame - frame ? lowerFrame : upperFrame;
}

function stepMusicalFrame(frame, sign, gridValue, context, grid) {
	const sampleRate = projectSampleRate(context);
	const tempoMap = projectTempoMap(context);
	const beat = sampleFrameToBeat(frame, tempoMap, sampleRate);
	let targetBeat;
	if (grid.bar) {
		const boundaries = surroundingBarBoundaries(beat, projectSignatureMap(context));
		const lowerFrame = beatToSampleFrame(boundaries.lowerBeat, tempoMap, sampleRate, 'point');
		const upperFrame = beatToSampleFrame(boundaries.upperBeat, tempoMap, sampleRate, 'point');
		const nearestBar = frame - lowerFrame < upperFrame - frame ? boundaries.lowerBar : boundaries.upperBar;
		targetBeat = barStartBeat(nearestBar + sign, projectSignatureMap(context));
	} else {
		const unit = musicalDivision(gridValue, context, grid);
		const index = roundRational(
			BigInt(beat.num) * BigInt(unit.den),
			BigInt(beat.den) * BigInt(unit.num),
			'point',
		) + sign;
		targetBeat = multiplyRationals(unit, index);
	}
	return beatToSampleFrame(targetBeat, tempoMap, sampleRate, 'point');
}

function musicalDivision(gridValue, context, grid) {
	const triplets = requestedTriplets(gridValue, context, grid);
	const division = triplets ? 3 * (grid.denominator / 2) : grid.denominator;
	return normalizeRational({ num: 4, den: division });
}

function projectTempoMap(context) {
	return context.tempoMap || context.project?.tempoMap || null;
}

function projectSignatureMap(context) {
	const map = context.signatureMap || context.project?.signatureMap;
	if (map) return map;
	const { numerator, denominator } = projectTempo(context);
	return { events: [{ bar: 0, numerator, denominator }] };
}

function boundedFrame(result, context) {
	const minimumFrame = context.minimumFrame === null ? null : safeInteger(context.minimumFrame ?? 0, 'minimumFrame');
	const maximumFrame = context.maximumFrame == null ? null : safeInteger(context.maximumFrame, 'maximumFrame');
	if (minimumFrame != null && maximumFrame != null && maximumFrame < minimumFrame) {
		throw new RangeError('maximumFrame cannot precede minimumFrame.');
	}
	return Math.min(maximumFrame ?? Number.MAX_SAFE_INTEGER, Math.max(minimumFrame ?? Number.MIN_SAFE_INTEGER, result));
}

function definition(upstreamType, id, category, extra = {}) {
	return Object.freeze({ upstreamType, id, category, ...extra });
}

function requestedTriplets(gridValue, context, grid) {
	if (!grid.triplets) return false;
	if (context.triplets != null) return Boolean(context.triplets);
	if (gridValue && typeof gridValue === 'object') return Boolean(gridValue.triplets || gridValue.isSnapTriplets || grid.impliedTriplets);
	return Boolean(grid.impliedTriplets || /(?:-triplet|t)$/i.test(String(gridValue)));
}

function projectSampleRate(context) {
	return positiveSafeInteger(context.sampleRate ?? context.project?.sampleRate ?? 48_000, 'sampleRate');
}

function projectTempo(context) {
	const tempo = context.tempo || context.project?.tempo || {};
	const tempoEvent = projectTempoMap(context)?.events?.[0];
	const signatureEvent = (context.signatureMap || context.project?.signatureMap)?.events?.[0];
	const signature = context.timeSignature || signatureEvent || tempo.timeSignature || {};
	const bpm = context.bpm == null && tempoEvent?.bpm
		? normalizeRational(tempoEvent.bpm)
		: positiveFinite(context.bpm ?? tempo.bpm ?? tempo.tempo ?? 120, 'tempo.bpm');
	const numerator = positiveSafeInteger(signature.numerator ?? signature.upper ?? 4, 'timeSignature.numerator');
	const denominator = positiveSafeInteger(signature.denominator ?? signature.lower ?? 4, 'timeSignature.denominator');
	if ((denominator & (denominator - 1)) !== 0) throw new RangeError('timeSignature.denominator must be a power of two.');
	return { bpm, numerator, denominator };
}

function normalizeMode(value) {
	const mode = MODE_ALIASES.get(String(value).trim().toLowerCase());
	if (!mode) throw new RangeError(`Unsupported snap mode: ${value}.`);
	return mode;
}

function positiveFinite(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${name} must be a positive finite number.`);
	return number;
}

function positiveSafeInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return number;
}

function safeInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number)) throw new RangeError(`${name} must be a safe integer.`);
	return number;
}
