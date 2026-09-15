/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeStandardModulationParams, standardVocoderBandGeometry, STANDARD_VOCODER_MAXIMUM_BANDS,
	STANDARD_VOCODER_NORMALIZATION_FLOOR, type StandardModulationOptions } from './modulation-definition.ts';

/** Unit-peak biquad, from the bilinear transform of the analog band-pass
 * (s/Q) / (s² + s/Q + 1). Transposed state uses double precision.
 * These are original equations; no Nyquist implementation is embedded here.
 */
class Biquad {
	private b0 = 0;
	private b1 = 0;
	private b2 = 0;
	private a1 = 0;
	private a2 = 0;
	private z1 = 0;
	private z2 = 0;
	configure(rate: number, frequency: number, q: number, lowpass = false): void {
		const angle = 2 * Math.PI * frequency / rate;
		const alpha = Math.sin(angle) / (2 * q);
		const inverse = 1 / (1 + alpha);
		this.b0 = lowpass ? (1 - Math.cos(angle)) * .5 * inverse : alpha * inverse;
		this.b1 = lowpass ? 2 * this.b0 : 0;
		this.b2 = lowpass ? this.b0 : -this.b0;
		this.a1 = -2 * Math.cos(angle) * inverse;
		this.a2 = (1 - alpha) * inverse;
	}
	process(sample: number): number {
		const output = this.b0 * sample + this.z1;
		this.z1 = this.b1 * sample + this.z2 - this.a1 * output;
		this.z2 = this.b2 * sample - this.a2 * output;
		return output;
	}
	reset(): void { this.z1 = 0; this.z2 = 0; }
}

/** A bounded analysis/synthesis bank transfers the left-channel envelope onto
 * the right-channel carrier. Mono accumulates sine carriers at the logarithmic
 * band centers, with a total amplitude of 0.5. Noise and pulses may be mixed in.
 * Tracks with more than two channels retain their additional channels dry.
 * Eight Butterworth envelope poles reject rectification ripple; a final
 * band-pass confines sidebands. Bounded running-peak normalization approaches
 * the offline effect's unity peak once the carrier settles. It cannot see
 * future peaks, so earlier samples may be louder than whole-selection
 * normalization. The held peak preserves subsequent fades and release tails.
 */
export function createVocoderProcessor({ sampleRate, channelCount, params = {} }: StandardModulationOptions) {
	if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) throw new RangeError('Invalid sample rate.');
	if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 32) throw new RangeError('Invalid channel count.');
	let settings = normalizeStandardModulationParams('vocoder', params);
	const capacity = STANDARD_VOCODER_MAXIMUM_BANDS;
	const analysis = Array.from({ length: capacity }, () => new Biquad());
	const carrier = Array.from({ length: capacity }, () => new Biquad());
	const synthesis = Array.from({ length: capacity }, () => new Biquad());
	const envelope = Array.from({ length: capacity }, () => Array.from({ length: 4 }, () => new Biquad()));
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
	let normalizationPeak = STANDARD_VOCODER_NORMALIZATION_FLOOR;
	function configureBank(): void {
		const { ratio, firstFrequency, q } = standardVocoderBandGeometry(sampleRate, settings.bands);
		for (let band = 0; band < settings.bands; band += 1) {
			const frequency = firstFrequency * ratio ** band;
			analysis[band].configure(sampleRate, frequency, q);
			carrier[band].configure(sampleRate, frequency, q);
			synthesis[band].configure(sampleRate, frequency, q);
			for (let section = 0; section < 4; section += 1) {
				const envelopeQ = 1 / (2 * Math.cos((2 * section + 1) * Math.PI / 16));
				envelope[band][section].configure(sampleRate, frequency / settings.distance, envelopeQ, true);
			}
			const angle = 2 * Math.PI * frequency / sampleRate;
			rotationReal[band] = Math.cos(angle);
			rotationImaginary[band] = Math.sin(angle);
		}
	}
	function configureLevels(): void {
		trackGain = Math.sqrt(settings.carrierLevel / 100);
		noiseGain = (settings.noiseLevel / 100) ** 2;
		radarGain = Math.sqrt(settings.radarLevel / 100);
		outputGain = 10 ** (settings.outputGain / 20);
		radarIncrement = settings.radarFrequency / sampleRate;
	}
	function reset(): void {
		for (let band = 0; band < capacity; band += 1) {
			analysis[band].reset(); carrier[band].reset(); synthesis[band].reset();
			for (const section of envelope[band]) section.reset();
		}
		oscillatorReal.fill(1); oscillatorImaginary.fill(0);
		noiseState = 0x6d2b79f5;
		radarPhase = 1;
		normalizationPeak = STANDARD_VOCODER_NORMALIZATION_FLOOR;
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
				let mixedCarrier = externalCarrier * trackGain + additionalCarrier;
				let vocoded = 0;
				for (let band = 0; band < settings.bands; band += 1) {
					let detected = Math.abs(analysis[band].process(modulator));
					for (const section of envelope[band]) detected = section.process(detected);
					const real = oscillatorReal[band];
					const imaginary = oscillatorImaginary[band];
					oscillatorReal[band] = real * rotationReal[band] - imaginary * rotationImaginary[band];
					oscillatorImaginary[band] = imaginary * rotationReal[band] + real * rotationImaginary[band];
					if (channelCount === 1) mixedCarrier += imaginary * .5 * trackGain / settings.bands;
					const carried = carrier[band].process(mixedCarrier);
					vocoded += synthesis[band].process(carried * detected);
				}
				normalizationPeak = Math.max(normalizationPeak, Math.abs(vocoded));
				vocoded = vocoded / normalizationPeak * outputGain;
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
