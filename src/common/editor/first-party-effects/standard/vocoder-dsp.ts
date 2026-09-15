/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeStandardModulationParams, STANDARD_VOCODER_MAXIMUM_BANDS, type StandardModulationOptions } from './modulation-definition.ts';

/** Unit-peak biquad, from the bilinear transform of the analog band-pass
 * (s/Q) / (s² + s/Q + 1). Transposed state uses double precision.
 * These are original equations; no Nyquist implementation is embedded here.
 */
class Bandpass {
	private b0 = 0;
	private a1 = 0;
	private a2 = 0;
	private z1 = 0;
	private z2 = 0;
	configure(rate: number, frequency: number, q: number): void {
		const angle = 2 * Math.PI * frequency / rate;
		const alpha = Math.sin(angle) / (2 * q);
		const inverse = 1 / (1 + alpha);
		this.b0 = alpha * inverse;
		this.a1 = -2 * Math.cos(angle) * inverse;
		this.a2 = (1 - alpha) * inverse;
	}
	process(sample: number): number {
		const output = this.b0 * sample + this.z1;
		this.z1 = this.z2 - this.a1 * output;
		this.z2 = -this.b0 * sample - this.a2 * output;
		return output;
	}
	reset(): void { this.z1 = 0; this.z2 = 0; }
}

/** A bounded analysis/synthesis bank transfers the left-channel envelope onto
 * the right-channel carrier. Mono uses a bank of 110 Hz harmonics, selecting
 * the nearest harmonic to each band. Noise and pulse carriers may be mixed in.
 * Tracks with more than two channels retain their additional channels dry.
 * Two envelope poles reject rectification ripple; a final band-pass confines
 * sidebands. Fixed 6 dB makeup preserves streaming causality; output gain is
 * explicit, rather than using a whole-selection peak normalization pass.
 */
export function createVocoderProcessor({ sampleRate, channelCount, params = {} }: StandardModulationOptions) {
	if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) throw new RangeError('Invalid sample rate.');
	if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 32) throw new RangeError('Invalid channel count.');
	let settings = normalizeStandardModulationParams('vocoder', params);
	const capacity = STANDARD_VOCODER_MAXIMUM_BANDS;
	const analysis = Array.from({ length: capacity }, () => new Bandpass());
	const carrier = Array.from({ length: capacity }, () => new Bandpass());
	const synthesis = Array.from({ length: capacity }, () => new Bandpass());
	const envelope = new Float64Array(capacity);
	const smoothedEnvelope = new Float64Array(capacity);
	const envelopeCoefficient = new Float64Array(capacity);
	const oscillatorReal = new Float64Array(capacity);
	const oscillatorImaginary = new Float64Array(capacity);
	const rotationReal = new Float64Array(capacity);
	const rotationImaginary = new Float64Array(capacity);
	let noiseState = 0x6d2b79f5;
	let radarPhase = 1;
	let trackGain = 0;
	let noiseGain = 0;
	let radarGain = 0;
	let outputGain = 0;
	let radarIncrement = 0;
	function configureBank(): void {
		const low = 20;
		const high = Math.min(16000, sampleRate * 0.45);
		const ratio = (high / low) ** (1 / settings.bands);
		const q = Math.sqrt(ratio) / (ratio - 1);
		for (let band = 0; band < settings.bands; band += 1) {
			const frequency = low * ratio ** (band + 0.5);
			analysis[band].configure(sampleRate, frequency, q);
			carrier[band].configure(sampleRate, frequency, q);
			synthesis[band].configure(sampleRate, frequency, q);
			envelopeCoefficient[band] = 1 - Math.exp(-2 * Math.PI * Math.min(frequency / settings.distance, sampleRate * 0.1) / sampleRate);
			const harmonic = Math.min(110 * Math.max(1, Math.round(frequency / 110)), sampleRate * 0.45);
			const angle = 2 * Math.PI * harmonic / sampleRate;
			rotationReal[band] = Math.cos(angle);
			rotationImaginary[band] = Math.sin(angle);
		}
	}
	function configureLevels(): void {
		trackGain = Math.sqrt(settings.carrierLevel / 100);
		noiseGain = (settings.noiseLevel / 100) ** 2;
		radarGain = Math.sqrt(settings.radarLevel / 100);
		outputGain = 2 * 10 ** (settings.outputGain / 20);
		radarIncrement = settings.radarFrequency / sampleRate;
	}
	function reset(): void {
		for (let band = 0; band < capacity; band += 1) {
			analysis[band].reset(); carrier[band].reset(); synthesis[band].reset();
		}
		envelope.fill(0); smoothedEnvelope.fill(0);
		oscillatorReal.fill(1); oscillatorImaginary.fill(0);
		noiseState = 0x6d2b79f5;
		radarPhase = 1;
	}
	configureBank(); configureLevels(); reset();
	return {
		reset,
		updateParams(value: Readonly<Record<string, unknown>>): void {
			const previous = settings;
			settings = normalizeStandardModulationParams('vocoder', { ...settings, ...value });
			if (settings.bands !== previous.bands || settings.distance !== previous.distance) {
				configureBank();
				if (settings.bands !== previous.bands) reset();
			}
			configureLevels();
		},
		processBlock(input: readonly Float32Array[], output: readonly Float32Array[], frames: number): void {
			for (let frame = 0; frame < frames; frame += 1) {
				const left = input[0]?.[frame] ?? 0;
				const right = input[1]?.[frame] ?? 0;
				const modulator = Number.isFinite(left) ? left : 0;
				const externalCarrier = Number.isFinite(right) ? right : 0;
				noiseState ^= noiseState << 13;
				noiseState ^= noiseState >>> 17;
				noiseState ^= noiseState << 5;
				const noise = (noiseState >>> 0) / 0x80000000 - 1;
				const pulse = radarPhase >= 1 ? 1 : 0;
				if (pulse) radarPhase -= 1;
				radarPhase += radarIncrement;
				const additionalCarrier = noise * noiseGain + pulse * radarGain;
				let vocoded = 0;
				for (let band = 0; band < settings.bands; band += 1) {
					const detected = Math.abs(analysis[band].process(modulator));
					const coefficient = envelopeCoefficient[band];
					envelope[band] += coefficient * (detected - envelope[band]);
					smoothedEnvelope[band] += coefficient * (envelope[band] - smoothedEnvelope[band]);
					const real = oscillatorReal[band];
					const imaginary = oscillatorImaginary[band];
					oscillatorReal[band] = real * rotationReal[band] - imaginary * rotationImaginary[band];
					oscillatorImaginary[band] = imaginary * rotationReal[band] + real * rotationImaginary[band];
					const source = channelCount === 1 ? imaginary * 0.35 : externalCarrier;
					const carried = carrier[band].process(source * trackGain + additionalCarrier);
					vocoded += synthesis[band].process(carried * smoothedEnvelope[band]);
				}
				vocoded *= outputGain;
				for (let channel = 0; channel < output.length; channel += 1) {
					if (channel >= channelCount) output[channel][frame] = 0;
					else if (channel >= 2) {
						const sample = input[channel]?.[frame] ?? 0;
						output[channel][frame] = Number.isFinite(sample) ? sample : 0;
					} else output[channel][frame] = channelCount > 1 && channel === 0 && settings.outputMode === 'both-channels' ? modulator : vocoded;
				}
			}
		},
	};
}
