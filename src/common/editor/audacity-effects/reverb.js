/*
 * Browser-native Schroeder/Freeverb-style reverb for the Audacity-compatible
 * effect registry. This implementation deliberately has no SoX dependency.
 * SPDX-License-Identifier: GPL-3.0-only
 */

const COMB_DELAYS_44K = Object.freeze([1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]);
const ALLPASS_DELAYS_44K = Object.freeze([556, 441, 341, 225]);

export function applyAudacityBrowserReverb(channels, sampleRate = 48_000, params = {}) {
	validateAudio(channels, sampleRate);
	const settings = normalizeReverbParams(params);
	const room = 0.28 + settings.roomSize / 100 * 0.7;
	const damping = Math.min(0.98, settings.damping / 100);
	const reverberance = 0.2 + settings.reverberance / 100 * 0.78;
	const wet = dbToLinear(settings.wetGainDb) * settings.reverberance / 100;
	const dry = settings.wetOnly ? 0 : dbToLinear(settings.dryGainDb);
	const width = settings.stereoWidth / 100;
	const scale = sampleRate / 44_100;
	const processed = channels.map((input, channel) => {
		const combs = COMB_DELAYS_44K.map((delay, index) => createComb(
			Math.max(1, Math.round((delay + channel * 23 + index * channel * 3) * scale)),
		));
		const allpasses = ALLPASS_DELAYS_44K.map((delay, index) => createAllpass(
			Math.max(1, Math.round((delay + channel * 17 + index * channel * 2) * scale)),
		));
		const output = new Float32Array(input.length);
		for (let frame = 0; frame < input.length; frame += 1) {
			let value = 0;
			for (const comb of combs) value += processComb(comb, input[frame], room * reverberance, damping);
			value /= combs.length;
			for (const allpass of allpasses) value = processAllpass(allpass, value, 0.5);
			output[frame] = value;
		}
		return output;
	});

	return channels.map((input, channel) => {
		const opposite = processed.length > 1 ? processed[(channel + 1) % processed.length] : processed[channel];
		const output = new Float32Array(input.length);
		const directWet = 0.5 + width * 0.5;
		const crossWet = 0.5 - width * 0.5;
		for (let frame = 0; frame < output.length; frame += 1) {
			output[frame] = input[frame] * dry + (processed[channel][frame] * directWet + opposite[frame] * crossWet) * wet;
		}
		return output;
	});
}

export function normalizeReverbParams(params = {}) {
	return {
		roomSize: numberInRange(params.roomSize, 75, 0, 100, 'roomSize'),
		reverberance: numberInRange(params.reverberance, 50, 0, 100, 'reverberance'),
		damping: numberInRange(params.damping, 50, 0, 100, 'damping'),
		wetGainDb: numberInRange(params.wetGainDb, -6, -60, 12, 'wetGainDb'),
		dryGainDb: numberInRange(params.dryGainDb, 0, -60, 12, 'dryGainDb'),
		stereoWidth: numberInRange(params.stereoWidth, 100, 0, 100, 'stereoWidth'),
		wetOnly: Boolean(params.wetOnly),
	};
}

function createComb(length) {
	return { buffer: new Float32Array(length), position: 0, filter: 0 };
}

function processComb(state, input, feedback, damping) {
	const output = state.buffer[state.position];
	state.filter = output * (1 - damping) + state.filter * damping;
	state.buffer[state.position] = input + state.filter * feedback;
	state.position = (state.position + 1) % state.buffer.length;
	return output;
}

function createAllpass(length) {
	return { buffer: new Float32Array(length), position: 0 };
}

function processAllpass(state, input, feedback) {
	const delayed = state.buffer[state.position];
	const output = delayed - input;
	state.buffer[state.position] = input + delayed * feedback;
	state.position = (state.position + 1) % state.buffer.length;
	return output;
}

function validateAudio(channels, sampleRate) {
	if (!Array.isArray(channels) || !channels.length || channels.some((channel) => !(channel instanceof Float32Array))) {
		throw new TypeError('Reverb requires planar Float32 audio.');
	}
	if (channels.some((channel) => channel.length !== channels[0].length)) throw new RangeError('Reverb channels must have equal lengths.');
	if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('sampleRate must be positive.');
}

function numberInRange(value, fallback, minimum, maximum, name) {
	const number = Number(value ?? fallback);
	if (!Number.isFinite(number) || number < minimum || number > maximum) throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
	return number;
}

function dbToLinear(value) {
	return 10 ** (value / 20);
}
