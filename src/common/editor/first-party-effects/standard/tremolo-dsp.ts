/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeStandardModulationParams, type StandardModulationOptions, type TremoloParams } from './modulation-definition.ts';

function waveformValue(waveform: TremoloParams['waveform'], phase: number): number {
	switch (waveform) {
		case 'sine': return -Math.cos(2 * Math.PI * phase);
		case 'triangle': return 1 - 4 * Math.abs(phase - 0.5);
		case 'sawtooth': return 2 * phase - 1;
		case 'inverse-sawtooth': return 1 - 2 * phase;
		case 'square': return phase < 0.5 ? -1 : 1;
	}
}

/** One linked oscillator attenuates every channel by the same gain. Phase zero
 * starts sine and triangle at their trough, matching the original effect.
 * Frequency updates preserve the running phase; the phase control restarts it.
 */
export function createTremoloProcessor({ sampleRate, channelCount, params = {} }: StandardModulationOptions) {
	if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) throw new RangeError('Invalid sample rate.');
	if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 32) throw new RangeError('Invalid channel count.');
	let settings = normalizeStandardModulationParams('tremolo', params);
	let phase = 0;
	function reset(): void {
		phase = settings.phase / 360;
		phase -= Math.floor(phase);
	}
	reset();
	return {
		reset,
		updateParams(value: Readonly<Record<string, unknown>>): void {
			const previous = settings;
			settings = normalizeStandardModulationParams('tremolo', { ...settings, ...value });
			if (settings.phase !== previous.phase) reset();
		},
		processBlock(input: readonly Float32Array[], output: readonly Float32Array[], frames: number): void {
			const depth = settings.depth / 200;
			const increment = settings.frequency / sampleRate;
			for (let frame = 0; frame < frames; frame += 1) {
				const gain = 1 - depth + depth * waveformValue(settings.waveform, phase);
				for (let channel = 0; channel < output.length; channel += 1) {
					const sample = channel < channelCount ? input[channel]?.[frame] ?? 0 : 0;
					output[channel][frame] = Number.isFinite(sample) ? sample * gain : 0;
				}
				phase += increment;
				phase -= Math.floor(phase);
			}
		},
	};
}
