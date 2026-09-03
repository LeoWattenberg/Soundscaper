/*
 * Bitcrusher DSP core, shared verbatim by the real-time AudioWorklet and the
 * destructive selection pass so the two cannot drift apart.
 *
 * The processor is a pure state machine over single samples: `processBlock`
 * only iterates it. Nothing is reset, recomputed or reseeded at a block
 * boundary, so a stream cut into 128-frame render quanta and the same stream
 * rendered offline in one pass produce identical output.
 *
 * Signal order is decimate, reconstruct, dither, quantize, mix. Dither is
 * added to the signal ahead of the quantizer, never to its output: adding it
 * afterwards would layer noise over the distortion instead of linearizing it.
 *
 * Quantizer. Levels are laid out mid-rise: with L = 2^bits levels the step is
 * 2/L and the reconstruction points sit at (k + 1/2)·step, so the grid is
 * symmetric about zero and spends exactly L codes on [-1, 1]. A mid-tread
 * grid would put a level on zero but cannot be symmetric with an even code
 * count, and it collapses at one bit, where mid-rise still degrades cleanly to
 * a +/-1/2 square wave. The trade is that zero is not itself a level, so
 * silence quantizes to half a step of DC -- inaudible at 16 bits, and an
 * intended part of the sound at low depths.
 *
 * Reconstruction is causal in every mode. A true windowed-sinc kernel would
 * need samples from the future, which costs latency that scales with the
 * decimation factor; a rack insert whose latency moves when a knob moves is
 * hostile to delay compensation, so the smoother modes interpolate from the
 * previously held value toward the current one across the hold interval using
 * only history.
 */

import { createSeededRandom, ditherFromUniforms } from '../../pcm-dither.js';
import {
	BITCRUSHER_DITHER_MODES,
	BITCRUSHER_INTERPOLATION_MODES,
	BITCRUSHER_MAXIMUM_BITS,
	BITCRUSHER_MAXIMUM_DOWNSAMPLING,
	BITCRUSHER_MINIMUM_BITS,
} from './definition.js';

export {
	BITCRUSHER_DITHER_MODES,
	BITCRUSHER_INTERPOLATION_MODES,
	BITCRUSHER_MAXIMUM_BITS,
	BITCRUSHER_MAXIMUM_DOWNSAMPLING,
	BITCRUSHER_MINIMUM_BITS,
};

/*
 * Lipshitz, Vanderkooy and Wannamaker's minimally audible noise shaping
 * filter (JAES 39(11), 1991), the same five taps Audacity and SoX use for
 * their shaped dither. The response is tuned for 44.1 kHz and drifts upward
 * with the sample rate; it stays the best of the fixed choices well beyond it.
 */
const NOISE_SHAPING_TAPS = Object.freeze([2.033, -2.165, 1.959, -1.590, 0.6149]);

/* Shaped feedback is unstable at low depths, where the shaped noise is larger
 * than the signal. Bounding the stored error keeps the loop from running away
 * without silently switching the mode the user chose. */
const NOISE_SHAPING_ERROR_LIMIT = 4;

/** Deterministic per-channel seed, never zero, decorrelated across channels. */
function channelSeed(seed, channel) {
	const mixed = Math.imul(seed >>> 0 || 1, 0x9e3779b1) + Math.imul(channel + 1, 0x85ebca6b);
	return (mixed >>> 0) || 0x9e3779b9;
}

function clamp(value, minimum, maximum) {
	return value < minimum ? minimum : value > maximum ? maximum : value;
}

/**
 * @param {{
 *   sampleRate?: number,
 *   channelCount: number,
 *   params: Record<string, unknown>,
 *   seed?: number,
 * }} options
 */
export function createBitcrusherProcessor(options) {
	const channelCount = Number(options?.channelCount);
	if (!Number.isSafeInteger(channelCount) || channelCount < 1 || channelCount > 32) {
		throw new RangeError('channelCount must be an integer between 1 and 32.');
	}
	const seed = Number.isSafeInteger(options?.seed) ? Number(options.seed) : 0x2f6e2b1;

	let bits = 16;
	let dither = 'none';
	let interpolation = 'sample-hold';
	let holdLength = 1;
	let wet = 1;
	let levels = 65_536;
	let step = 2 / levels;
	let lowestCode = -levels / 2;
	let highestCode = levels / 2 - 1;
	let smoothingCoefficient = 1;

	const randoms = Array.from({ length: channelCount }, (unused, channel) => (
		createSeededRandom(channelSeed(seed, channel))
	));
	const held = new Float64Array(channelCount);
	const previousHeld = new Float64Array(channelCount);
	const earlierHeld = new Float64Array(channelCount);
	const smoothed = new Float64Array(channelCount);
	const ditherState = new Float64Array(channelCount);
	const shapingErrors = Array.from({ length: channelCount }, () => new Float64Array(NOISE_SHAPING_TAPS.length));
	let phase = 0;
	let heldAge = 0;
	let primed = false;

	function configure(params) {
		bits = clamp(Math.round(Number(params?.bitDepth ?? 16)), BITCRUSHER_MINIMUM_BITS, BITCRUSHER_MAXIMUM_BITS);
		dither = BITCRUSHER_DITHER_MODES.includes(params?.dither) ? params.dither : 'none';
		interpolation = BITCRUSHER_INTERPOLATION_MODES.includes(params?.interpolation)
			? params.interpolation
			: 'sample-hold';
		const requested = Number(params?.downsampling ?? 1);
		holdLength = clamp(Number.isFinite(requested) ? requested : 1, 1, BITCRUSHER_MAXIMUM_DOWNSAMPLING);
		const mix = Number(params?.mix ?? 100);
		wet = clamp(Number.isFinite(mix) ? mix / 100 : 1, 0, 1);
		levels = 2 ** bits;
		step = 2 / levels;
		lowestCode = -levels / 2;
		highestCode = levels / 2 - 1;
		// 10% to 90% of the way to a newly held value over one hold interval.
		smoothingCoefficient = 1 - Math.exp(-2.2 / holdLength);
	}

	function reset() {
		held.fill(0);
		previousHeld.fill(0);
		earlierHeld.fill(0);
		smoothed.fill(0);
		ditherState.fill(0);
		for (const errors of shapingErrors) errors.fill(0);
		for (let channel = 0; channel < channelCount; channel += 1) {
			randoms[channel] = createSeededRandom(channelSeed(seed, channel));
		}
		phase = 0;
		heldAge = 0;
		primed = false;
	}

	/** Quantize one sample onto the mid-rise grid, dithering ahead of the step. */
	function quantize(sample, channel) {
		// Draw unconditionally, and always the same count, so the noise stream
		// stays aligned with the sample index whatever the dither mode is doing.
		const random = randoms[channel];
		const first = random();
		const second = random();
		const codes = clamp(sample, -1, 1) / step;
		const errors = shapingErrors[channel];
		let shaped = codes;
		if (dither === 'shaped') {
			for (let tap = 0; tap < NOISE_SHAPING_TAPS.length; tap += 1) {
				shaped += NOISE_SHAPING_TAPS[tap] * errors[tap];
			}
		}
		const noise = dither === 'shaped'
			? first - second
			: ditherFromUniforms(dither, first, second, channel, ditherState);
		const code = clamp(Math.floor(shaped + noise), lowestCode, highestCode);
		const quantized = code + 0.5;
		if (dither === 'shaped') {
			errors.copyWithin(1, 0);
			errors[0] = clamp(shaped - quantized, -NOISE_SHAPING_ERROR_LIMIT, NOISE_SHAPING_ERROR_LIMIT);
		}
		return quantized * step;
	}

	function reconstruct(channel, position) {
		const target = held[channel];
		if (interpolation === 'sample-hold') return target;
		const previous = previousHeld[channel];
		if (interpolation === 'linear') return previous + (target - previous) * position;
		if (interpolation === 'smooth') {
			smoothed[channel] += (target - smoothed[channel]) * smoothingCoefficient;
			return smoothed[channel];
		}
		// Cubic Hermite over the segment that ends at the current held value.
		// The incoming tangent is the centred difference across the previous
		// value; the outgoing one is the backward difference, which is the
		// closest causal stand-in for a centred tangent that would need the
		// next held sample.
		const incoming = (target - earlierHeld[channel]) * 0.5;
		const outgoing = target - previous;
		const squared = position * position;
		const cubed = squared * position;
		return (2 * cubed - 3 * squared + 1) * previous
			+ (cubed - 2 * squared + position) * incoming
			+ (-2 * cubed + 3 * squared) * target
			+ (cubed - squared) * outgoing;
	}

	configure(options?.params ?? {});

	return {
		reset,
		updateParams(params) {
			configure(params);
		},
		/**
		 * @param {ReadonlyArray<Float32Array>} input
		 * @param {ReadonlyArray<Float32Array>} output
		 * @param {number} frames
		 */
		processBlock(input, output, frames) {
			const increment = 1 / holdLength;
			for (let frame = 0; frame < frames; frame += 1) {
				phase += increment;
				let captured = false;
				let first = false;
				if (!primed) {
					// Capture on the very first frame and start the interval
					// there, so holds land on multiples of the hold length.
					primed = true;
					captured = true;
					first = true;
					phase = 0;
				} else if (phase >= 1) {
					phase -= 1;
					captured = true;
				}
				if (captured) {
					heldAge = 0;
					for (let channel = 0; channel < channelCount; channel += 1) {
						earlierHeld[channel] = previousHeld[channel];
						previousHeld[channel] = held[channel];
						held[channel] = quantize(input[channel]?.[frame] ?? 0, channel);
						// Start the one-pole at the first held value rather
						// than ramping up from silence into the material.
						if (first) {
							previousHeld[channel] = held[channel];
							earlierHeld[channel] = held[channel];
							smoothed[channel] = held[channel];
						}
					}
				} else heldAge += 1;
				const position = Math.min(1, (heldAge + 1) / holdLength);
				for (let channel = 0; channel < output.length; channel += 1) {
					const dry = input[channel]?.[frame] ?? 0;
					const crushed = channel < channelCount ? reconstruct(channel, position) : dry;
					output[channel][frame] = dry + (crushed - dry) * wet;
				}
			}
		},
	};
}

/** Apply the effect to whole channels in one pass, as the selection path does. */
export function applyBitcrusher(channels, sampleRate, params = {}, options = {}) {
	if (!Array.isArray(channels) || channels.length === 0) {
		throw new TypeError('At least one channel of audio is required.');
	}
	const frames = channels[0].length;
	for (const channel of channels) {
		if (!(channel instanceof Float32Array)) throw new TypeError('Every channel must be a Float32Array.');
		if (channel.length !== frames) throw new RangeError('Every channel must have the same length.');
	}
	const processor = createBitcrusherProcessor({
		sampleRate,
		channelCount: channels.length,
		params,
		seed: options.seed,
	});
	const output = channels.map(() => new Float32Array(frames));
	processor.processBlock(channels, output, frames);
	return output;
}
