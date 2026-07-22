const DB_LINEAR_SCALE_POINTS = Object.freeze([
	Object.freeze([0, 1]),
	Object.freeze([1 / 3, 0.5]),
	Object.freeze([1 / 2, 0.3]),
	Object.freeze([2 / 3, 0.15]),
	Object.freeze([5 / 6, 0.075]),
	Object.freeze([1, 0]),
]);
const DB_LINEAR_LOW_STEPS = Object.freeze({
	36: Object.freeze([-36, -18, -12, -9, -6, -3, 0]),
	48: Object.freeze([-48, -24, -16, -12, -9, -6, 0]),
	60: Object.freeze([-60, -30, -20, -15, -10, -5, 0]),
	72: Object.freeze([-72, -36, -24, -18, -12, -6, 0]),
	84: Object.freeze([-84, -42, -28, -21, -14, -7, 0]),
	96: Object.freeze([-96, -48, -32, -24, -18, -12, 0]),
	120: Object.freeze([-120, -60, -40, -30, -20, -10, 0]),
	144: Object.freeze([-144, -72, -48, -36, -27, -18, 0]),
});
const DB_LINEAR_HIGH_STEPS = Object.freeze({
	36: Object.freeze([-36, -30, -24, -18, -15, -12, -9, -6, -3, 0]),
	48: Object.freeze([-48, -40, -32, -24, -20, -16, -12, -9, -6, 0]),
	60: Object.freeze([-60, -50, -40, -30, -24, -18, -12, -9, -6, -3, 0]),
	72: Object.freeze([-72, -60, -48, -36, -30, -24, -18, -12, -6, 0]),
	84: Object.freeze([-84, -72, -60, -48, -42, -36, -30, -24, -18, -12, -9, -6, 0]),
	96: Object.freeze([-96, -80, -64, -48, -40, -32, -24, -18, -12, 0]),
	120: Object.freeze([-120, -100, -80, -60, -48, -36, -24, -18, -12, -6, 0]),
	144: Object.freeze([-144, -96, -72, -60, -48, -36, -27, -18, 0]),
});

export function ebuMeterBounds(scale = 'plus9') {
	return scale === 'plus18'
		? Object.freeze({ minimumLufs: -59, maximumLufs: -5 })
		: Object.freeze({ minimumLufs: -41, maximumLufs: -14 });
}

export function ebuMeterPercent(lufs, scale = 'plus9') {
	const { minimumLufs, maximumLufs } = ebuMeterBounds(scale);
	const value = Number.isFinite(lufs) ? lufs : minimumLufs;
	return Math.max(0, Math.min(100, (value - minimumLufs) / (maximumLufs - minimumLufs) * 100));
}

export function ebuMeterTicks(scale = 'plus9', unit = 'absolute', meterSize = 280) {
	const { minimumLufs, maximumLufs } = ebuMeterBounds(scale);
	const size = Math.max(0, Number(meterSize) || 0);
	const increment = size >= 400 ? 3 : scale === 'plus18' ? 9 : 6;
	const ticks = [];
	for (let lufs = minimumLufs; lufs <= maximumLufs; lufs += increment) ticks.push(lufs);
	if (ticks[ticks.length - 1] !== maximumLufs) ticks.push(maximumLufs);
	if (!ticks.includes(-23)) ticks.push(-23);
	return ticks.sort((first, second) => first - second).map((lufs) => Object.freeze({
		lufs,
		label: String(unit === 'relative' ? lufs + 23 : lufs).replace('-', '−'),
		position: ebuMeterPercent(lufs, scale),
		target: lufs === -23,
	}));
}

export function playbackMeterAmplitudeToDb(amplitude, dbRange = 60) {
	const range = Math.max(1, Number(dbRange) || 60);
	const value = Number(amplitude);
	if (!Number.isFinite(value) || value <= 0) return -range;
	return Math.max(-range, Math.min(0, 20 * Math.log10(value)));
}

export function playbackMeterPercent(dbfs, type = 'db-log', dbRange = 60) {
	const range = Math.max(1, Number(dbRange) || 60);
	const db = Math.max(-range, Math.min(0, Number.isFinite(dbfs) ? dbfs : -range));
	if (type === 'amplitude') {
		if (db <= -60) return 0;
		return Math.max(0, Math.min(100, 10 ** (db / 20) * 100));
	}
	if (type !== 'db-linear') return (db + range) / range * 100;
	const depth = -db / range;
	for (let index = 1; index < DB_LINEAR_SCALE_POINTS.length; index += 1) {
		const [nextDepth, nextPosition] = DB_LINEAR_SCALE_POINTS[index];
		const [previousDepth, previousPosition] = DB_LINEAR_SCALE_POINTS[index - 1];
		if (depth > nextDepth) continue;
		const progress = (depth - previousDepth) / (nextDepth - previousDepth);
		return (previousPosition + (nextPosition - previousPosition) * progress) * 100;
	}
	return 0;
}

export function playbackMeterGainFromPosition(position, type = 'db-log', dbRange = 60) {
	const normalizedPosition = Math.max(0, Math.min(1, Number(position) || 0));
	if (normalizedPosition <= 0) return 0;
	if (type === 'amplitude') return normalizedPosition;
	const range = Math.max(1, Number(dbRange) || 60);
	let depth = 1 - normalizedPosition;
	if (type === 'db-linear') {
		for (let index = 1; index < DB_LINEAR_SCALE_POINTS.length; index += 1) {
			const [nextDepth, nextPosition] = DB_LINEAR_SCALE_POINTS[index];
			const [previousDepth, previousPosition] = DB_LINEAR_SCALE_POINTS[index - 1];
			if (normalizedPosition < nextPosition) continue;
			const progress = (previousPosition - normalizedPosition) / (previousPosition - nextPosition);
			depth = previousDepth + (nextDepth - previousDepth) * progress;
			break;
		}
	}
	return Math.max(0, Math.min(1, 10 ** (-range * depth / 20)));
}

export function playbackMeterFullSteps(type = 'db-log', dbRange = 60, meterSize = 280) {
	const range = Math.max(1, Math.round(Number(dbRange) || 60));
	const size = Math.max(0, Math.round(Number(meterSize) || 0));
	if (size <= 0) return [];
	if (type === 'db-linear') {
		const table = size < 400 ? DB_LINEAR_LOW_STEPS : DB_LINEAR_HIGH_STEPS;
		return [...(table[range] || [])];
	}
	if (type === 'amplitude') {
		const increments = [0.05, 0.1, 0.2, 0.25, 0.5];
		const increment = increments.find((candidate) => size / 50 >= 1 / candidate) || 0.1;
		const steps = [];
		for (let value = 0; value <= 1 + 0.000001; value += increment) {
			steps.push(Number(value.toFixed(10)));
		}
		return steps;
	}
	const increments = [1, 2, 3, 6, 12, 24, 48];
	const increment = increments.find((candidate) => size / 30 >= range / candidate);
	if (!increment) return [];
	const steps = [];
	for (let value = -range; value <= 0; value += increment) steps.push(value);
	return steps;
}
