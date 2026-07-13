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
	const grid = audioEditorSnapGrid(gridValue);
	const sampleRate = projectSampleRate(context);
	if (grid.category === 'samples') return 1;
	if (grid.category === 'time' || grid.category === 'video' || grid.category === 'cdda') {
		return sampleRate * grid.frequencyDenominator / grid.frequencyNumerator;
	}
	const { bpm, numerator, denominator } = projectTempo(context);
	const quarterFrames = sampleRate * 60 / bpm;
	if (grid.bar) return quarterFrames * 4 * numerator / denominator;
	const triplets = requestedTriplets(gridValue, context, grid);
	const division = triplets ? 3 * (grid.denominator / 2) : grid.denominator;
	return quarterFrames * 4 / division;
}

/**
 * Snap an integer timeline frame to the selected grid without cumulative drift.
 * Every result is calculated from the project origin, including rational video
 * rates such as 30000/1001 and grids that do not divide the project rate.
 */
export function snapAudioEditorProjectFrame(frame, gridValue, context = {}) {
	const inputFrame = safeInteger(frame, 'frame');
	const mode = normalizeMode(context.mode || (typeof gridValue === 'object' ? gridValue.mode : null) || 'nearest');
	const step = audioEditorSnapStepFrames(gridValue, context);
	const gridIndex = quantize(inputFrame / step, mode);
	const result = roundHalfAwayFromZero(gridIndex * step);
	if (!Number.isSafeInteger(result)) throw new RangeError('The snapped frame is outside the safe integer range.');
	const minimumFrame = context.minimumFrame === null ? null : safeInteger(context.minimumFrame ?? 0, 'minimumFrame');
	const maximumFrame = context.maximumFrame == null ? null : safeInteger(context.maximumFrame, 'maximumFrame');
	if (minimumFrame != null && maximumFrame != null && maximumFrame < minimumFrame) {
		throw new RangeError('maximumFrame cannot precede minimumFrame.');
	}
	return Math.min(maximumFrame ?? Number.MAX_SAFE_INTEGER, Math.max(minimumFrame ?? Number.MIN_SAFE_INTEGER, result));
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
	const step = audioEditorSnapStepFrames(gridValue, context);
	const inputFrame = safeInteger(frame, 'frame');
	const result = roundHalfAwayFromZero((roundHalfAwayFromZero(inputFrame / step) + sign) * step);
	if (!Number.isSafeInteger(result)) throw new RangeError('The stepped frame is outside the safe integer range.');
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
	return positiveFinite(context.sampleRate ?? context.project?.sampleRate ?? 48_000, 'sampleRate');
}

function projectTempo(context) {
	const tempo = context.tempo || context.project?.tempo || {};
	const signature = context.timeSignature || tempo.timeSignature || {};
	const bpm = positiveFinite(context.bpm ?? tempo.bpm ?? tempo.tempo ?? 120, 'tempo.bpm');
	const numerator = positiveSafeInteger(signature.numerator ?? signature.upper ?? 4, 'timeSignature.numerator');
	const denominator = positiveSafeInteger(signature.denominator ?? signature.lower ?? 4, 'timeSignature.denominator');
	if ((denominator & (denominator - 1)) !== 0) throw new RangeError('timeSignature.denominator must be a power of two.');
	return { bpm, numerator, denominator };
}

function quantize(value, mode) {
	if (mode === 'previous') return Math.floor(value);
	if (mode === 'next') return Math.ceil(value);
	return roundHalfAwayFromZero(value);
}

function roundHalfAwayFromZero(value) {
	return value < 0 ? -Math.round(-value) : Math.round(value);
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
