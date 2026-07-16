/*
 * Repository-owned parametric EQ parameter and DSP packet normalization.
 *
 * The editor model keeps user-facing units and names. The packet is the narrow,
 * versioned boundary consumed by the realtime and destructive DSP backends.
 */

export const PARAMETRIC_EQ_PACKET_VERSION = 1;
export const PARAMETRIC_EQ_MAX_BANDS = 12;
export const PARAMETRIC_EQ_FREQUENCY_RANGE = Object.freeze([10, 24_000]);
export const PARAMETRIC_EQ_GAIN_RANGE = Object.freeze([-24, 24]);
export const PARAMETRIC_EQ_Q_RANGE = Object.freeze([0.1, 30]);
export const PARAMETRIC_EQ_SLOPES = Object.freeze([12, 24, 36, 48]);
export const PARAMETRIC_EQ_TYPES = Object.freeze([
	'peaking',
	'lowshelf',
	'highshelf',
	'highpass',
	'lowpass',
	'notch',
]);

const DEFAULT_BANDS = Object.freeze([
	Object.freeze({ frequency: 100, gain: 0, q: 1 }),
	Object.freeze({ frequency: 500, gain: 0, q: 1 }),
	Object.freeze({ frequency: 2_000, gain: 0, q: 1 }),
	Object.freeze({ frequency: 8_000, gain: 0, q: 1 }),
]);

const TYPE_ALIASES = Object.freeze({
	bell: 'peaking',
	peak: 'peaking',
	peaking: 'peaking',
	'lowshelf': 'lowshelf',
	'low-shelf': 'lowshelf',
	'low_shelf': 'lowshelf',
	'highshelf': 'highshelf',
	'high-shelf': 'highshelf',
	'high_shelf': 'highshelf',
	'highpass': 'highpass',
	'high-pass': 'highpass',
	'lowcut': 'highpass',
	'low-cut': 'highpass',
	'low_cut': 'highpass',
	'lowpass': 'lowpass',
	'low-pass': 'lowpass',
	'highcut': 'lowpass',
	'high-cut': 'lowpass',
	'high_cut': 'lowpass',
	'notch': 'notch',
	'bandstop': 'notch',
	'band-stop': 'notch',
});

export function normalizeParametricEqParams(params = {}, effectId = 'eq') {
	const source = params && typeof params === 'object' ? params : {};
	const sourceBands = Array.isArray(source.bands) ? source.bands : DEFAULT_BANDS;
	const usedIds = new Set();
	const bands = sourceBands.slice(0, PARAMETRIC_EQ_MAX_BANDS).map((band, index) => {
		const value = band && typeof band === 'object' ? band : {};
		const fallbackId = `${safeId(effectId, 'eq')}-band-${index + 1}`;
		let id = safeId(value.id, fallbackId);
		if (usedIds.has(id)) id = uniqueId(fallbackId, usedIds);
		usedIds.add(id);
		return {
			id,
			type: normalizeType(value.type),
			enabled: value.enabled !== false,
			frequency: finiteInRange(value.frequency ?? value.frequencyHz, 1_000, PARAMETRIC_EQ_FREQUENCY_RANGE),
			gain: finiteInRange(value.gain ?? value.gainDb, 0, PARAMETRIC_EQ_GAIN_RANGE),
			q: finiteInRange(value.q ?? value.Q, 1, PARAMETRIC_EQ_Q_RANGE),
			slope: normalizeSlope(value.slope ?? value.slopeDbPerOctave),
		};
	});
	return {
		bands,
		outputGain: finiteInRange(source.outputGain ?? source.outputGainDb, 0, PARAMETRIC_EQ_GAIN_RANGE),
	};
}

export function packParametricEqParams(params = {}, effectId = 'eq') {
	if (isPacket(params)) return packNormalizedPacket(params, effectId);
	const normalized = normalizeParametricEqParams(params, effectId);
	return {
		version: PARAMETRIC_EQ_PACKET_VERSION,
		outputGainDb: normalized.outputGain,
		bands: normalized.bands.map((band) => ({
			id: band.id,
			type: band.type,
			enabled: band.enabled,
			frequencyHz: band.frequency,
			gainDb: band.gain,
			q: band.q,
			slopeDbPerOctave: band.slope,
		})),
	};
}

export function isParametricEqPacket(value) {
	return isPacket(value);
}

function packNormalizedPacket(packet, effectId) {
	return packParametricEqParams({
		outputGain: packet.outputGainDb,
		bands: packet.bands.map((band) => ({
			id: band.id,
			type: band.type,
			enabled: band.enabled,
			frequency: band.frequencyHz,
			gain: band.gainDb,
			q: band.q,
			slope: band.slopeDbPerOctave,
		})),
	}, effectId);
}

function isPacket(value) {
	return Boolean(
		value
		&& typeof value === 'object'
		&& Number(value.version) === PARAMETRIC_EQ_PACKET_VERSION
		&& Array.isArray(value.bands),
	);
}

function normalizeType(value) {
	return TYPE_ALIASES[String(value ?? 'peaking').trim().toLowerCase()] || 'peaking';
}

function normalizeSlope(value) {
	const number = Number(value);
	if (!Number.isFinite(number)) return PARAMETRIC_EQ_SLOPES[0];
	return PARAMETRIC_EQ_SLOPES.reduce((nearest, candidate) => (
		Math.abs(candidate - number) < Math.abs(nearest - number) ? candidate : nearest
	), PARAMETRIC_EQ_SLOPES[0]);
}

function finiteInRange(value, fallback, [minimum, maximum]) {
	const number = Number(value);
	return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : fallback));
}

function safeId(value, fallback) {
	const string = String(value ?? '').trim();
	return string && string.length <= 160 ? string : fallback;
}

function uniqueId(fallback, usedIds) {
	let suffix = 2;
	let candidate = fallback;
	while (usedIds.has(candidate)) {
		candidate = `${fallback}-${suffix}`;
		suffix += 1;
	}
	return candidate;
}
