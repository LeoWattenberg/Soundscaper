/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeBandDynamicsParams } from '../dynamics/definition.ts';
import { BandCompressor, ComplementaryCrossover, validateChannels, validateGeometry, type BandDynamicsOptions } from '../dynamics/core.ts';

/** Split-band de-essing. A second high-pass in the detector rejects vocal body;
 * only the complementary upper audio band is attenuated. All channels share
 * the strongest detector, so a sibilant on one side cannot move the stereo image.
 */
export function createDeesserProcessor({ sampleRate, channelCount, params = {} }: BandDynamicsOptions) {
	validateGeometry(sampleRate, channelCount);
	let settings = normalizeBandDynamicsParams('deesser', params);
	const crossover = new ComplementaryCrossover(sampleRate, channelCount, settings.frequency);
	const detector = new ComplementaryCrossover(sampleRate, channelCount, settings.frequency);
	const compressor = new BandCompressor(sampleRate);
	const dry = new Float64Array(channelCount);
	const high = new Float64Array(channelCount);
	function updateParams(value: Readonly<Record<string, unknown>>): void {
		settings = normalizeBandDynamicsParams('deesser', { ...settings, ...value });
		crossover.configure(settings.frequency);
		detector.configure(settings.frequency);
		compressor.configure(settings.threshold, 6, settings.attack, settings.release, settings.reduction);
	}
	updateParams(settings);
	return {
		updateParams,
		reset() { crossover.reset(); detector.reset(); compressor.reset(); },
		processBlock(input: readonly Float32Array[], output: readonly Float32Array[], frames: number) {
			for (let frame = 0; frame < frames; frame += 1) {
				crossover.tick(); detector.tick();
				let power = 0;
				for (let channel = 0; channel < channelCount; channel += 1) {
					const value = input[channel]?.[frame] ?? 0;
					dry[channel] = Number.isFinite(value) ? value : 0;
					high[channel] = dry[channel] - crossover.low(dry[channel], channel);
					const detected = high[channel] - detector.low(high[channel], channel);
					power = Math.max(power, detected * detected);
				}
				const gain = compressor.gain(power);
				for (let channel = 0; channel < output.length; channel += 1) {
					output[channel][frame] = channel < channelCount ? dry[channel] + high[channel] * (gain - 1) : 0;
				}
			}
		},
	};
}

export function applyDeesser(channels: readonly Float32Array[], sampleRate: number, params: Readonly<Record<string, unknown>> = {}) {
	const frames = validateChannels(channels, sampleRate);
	const processor = createDeesserProcessor({ sampleRate, channelCount: channels.length, params });
	const output = channels.map(() => new Float32Array(frames));
	processor.processBlock(channels, output, frames);
	return output;
}
