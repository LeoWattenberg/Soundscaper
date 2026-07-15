const DEFAULT_ENVELOPE_VALUE = 1;

/** Convert the editor's linear envelope value to the design system's dB value. */
export function envelopeValueToDb(value) {
	const linear = Number(value);
	if (!Number.isFinite(linear) || linear <= 0) return -Infinity;
	return 20 * Math.log10(linear);
}

/** Convert a design-system dB value to the editor's linear envelope value. */
export function envelopeDbToValue(db, maximum = 16) {
	if (db === -Infinity) return 0;
	const value = 10 ** (Number(db) / 20);
	if (!Number.isFinite(value)) return value > 0 ? maximum : 0;
	return Math.max(0, Math.min(maximum, value));
}

/**
 * Return the linearly interpolated envelope value at a clip-local frame.
 * Missing endpoints use unity gain, matching Audacity's clip envelope.
 */
export function envelopeValueAtFrame(points, frame, durationFrames) {
	const duration = positiveFrame(durationFrames, 'durationFrames');
	const target = Math.max(0, Math.min(duration, finiteFrame(frame, 'frame')));
	const normalized = normalizedEnvelope(points, duration);
	if (!normalized.length) return DEFAULT_ENVELOPE_VALUE;
	let left = { frame: 0, value: DEFAULT_ENVELOPE_VALUE };
	for (const point of normalized) {
		if (point.frame === target) return point.value;
		if (point.frame > target) return interpolate(left, point, target);
		left = point;
	}
	return left.value;
}

/** Convert canonical clip-local points to the design-system shape. */
export function envelopeFramesToDesignPoints(points, sampleRate, {
	startFrame = 0,
	endFrame = Infinity,
} = {}) {
	const rate = positiveFrame(sampleRate, 'sampleRate');
	const start = finiteFrame(startFrame, 'startFrame');
	const end = endFrame === Infinity ? Infinity : finiteFrame(endFrame, 'endFrame');
	return (Array.isArray(points) ? points : [])
		.filter((point) => point.frame >= start && point.frame <= end)
		.map((point) => ({
			time: (point.frame - start) / rate,
			db: envelopeValueToDb(point.value),
		}));
}

/**
 * Merge edited design-system points back into a canonical clip envelope while
 * retaining points outside a projected viewport segment.
 */
export function mergeDesignEnvelopePoints(current, points, sampleRate, durationFrames, {
	startFrame = 0,
	endFrame = durationFrames,
	maximumValue = 2,
} = {}) {
	const rate = positiveFrame(sampleRate, 'sampleRate');
	const duration = positiveFrame(durationFrames, 'durationFrames');
	const start = Math.max(0, Math.min(duration, finiteFrame(startFrame, 'startFrame')));
	const end = Math.max(start, Math.min(duration, finiteFrame(endFrame, 'endFrame')));
	const outside = (Array.isArray(current) ? current : [])
		.filter((point) => point.frame < start || point.frame > end)
		.map((point) => ({ frame: point.frame, value: point.value }));
	const edited = (Array.isArray(points) ? points : []).map((point) => ({
		frame: Math.max(start, Math.min(end, start + Math.round(Number(point.time) * rate))),
		value: envelopeDbToValue(point.db, maximumValue),
	}));
	const sorted = [...outside, ...edited].sort((left, right) => left.frame - right.frame);
	const unique = [];
	for (const point of sorted) {
		if (unique.at(-1)?.frame === point.frame) unique[unique.length - 1] = point;
		else unique.push(point);
	}
	return unique;
}

function normalizedEnvelope(points, durationFrames) {
	return (Array.isArray(points) ? points : [])
		.filter((point) => Number.isFinite(point?.frame) && Number.isFinite(point?.value))
		.map((point) => ({
			frame: Math.max(0, Math.min(durationFrames, Number(point.frame))),
			value: Math.max(0, Number(point.value)),
		}))
		.sort((left, right) => left.frame - right.frame);
}

function interpolate(left, right, frame) {
	if (right.frame <= left.frame) return right.value;
	const fraction = (frame - left.frame) / (right.frame - left.frame);
	return left.value + (right.value - left.value) * fraction;
}

function finiteFrame(value, name) {
	const frame = Number(value);
	if (!Number.isFinite(frame) || frame < 0) throw new RangeError(`${name} must be a non-negative finite number.`);
	return frame;
}

function positiveFrame(value, name) {
	const frame = finiteFrame(value, name);
	if (frame <= 0) throw new RangeError(`${name} must be positive.`);
	return frame;
}
