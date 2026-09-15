/* SPDX-License-Identifier: AGPL-3.0-only */

import { loadStaffPadWasm, renderStaffPad } from '../../staffpad/runtime.js';
import type { StaffPadWasmRuntime } from '../../staffpad/runtime.js';
import { createStaffPadChangeSpeedTransform } from '../../staffpad/parameters.js';
import { createStaffPadRuntimeLoader } from '../../staffpad/runtime-loader.js';
import { applyStandardEffect } from './dsp.ts';
import { normalizeStandardDelayParams } from './delay-definition.ts';
import { delaySelectionPitchMode, delaySelectionDuration, delayEchoOffsetFrames, standardDelaySelectionOutputFrames } from './delay-selection-contract.ts';
import { STAFFPAD_MAXIMUM_RENDER_BYTES } from '../../staffpad/parameters.js';
import { standardSelectionEffectPeakBytes } from './selection-contract.ts';

const getRuntime = createStaffPadRuntimeLoader(loadStaffPadWasm);
interface Context {
	readonly staffPadRuntime?: StaffPadWasmRuntime;
	readonly staffPadWasmSource?: Parameters<typeof loadStaffPadWasm>[0];
	readonly isCancelled?: () => boolean;
	readonly spectralSelection?: unknown;
}

/** Speed echoes replay a finite selection at a changed rate. The selection
 * supplies the complete source that an unlimited realtime bus cannot supply.
 */
export async function applyStandardDelaySelection(channels: readonly Float32Array[], sampleRate: number,
	params: Readonly<Record<string, unknown>>, context: Context = {}): Promise<Float32Array[]> {
	const normalized = normalizeStandardDelayParams(params);
	const frames = standardDelaySelectionOutputFrames(channels[0].length, params, sampleRate);
	if (context.spectralSelection && delaySelectionDuration(params.duration) === 'extend') throw new RangeError('Frequency-selected Delay must keep the selected duration.');
	const peakBytes = standardSelectionEffectPeakBytes('multi-tap-delay', channels[0].length, params, { sampleRate, channelCount: channels.length });
	if (peakBytes > STAFFPAD_MAXIMUM_RENDER_BYTES) throw new RangeError('The delay selection exceeds the bounded render memory limit. Reduce the selection, pitch shift or echoes.');
	const input = frames === channels[0].length ? channels : channels.map(channel => {
		const extended = new Float32Array(frames);
		extended.set(channel);
		return extended;
	});
	if (Number(normalized.pitchShift) === 0 || Number(normalized.mix) === 0) return applyStandardEffect('multi-tap-delay', input, sampleRate, normalized);
	const runtime = context.staffPadRuntime ?? await (context.staffPadWasmSource == null ? getRuntime() : loadStaffPadWasm(context.staffPadWasmSource));
	if (delaySelectionPitchMode(params.pitchMode) === 'pitch-shift') return applyStandardEffect('multi-tap-delay', input, sampleRate, normalized, runtime);
	const output = input.map(channel => channel.slice());
	let echoSource = channels.map(channel => channel.slice());
	const echoes = Number(normalized.echoes);
	const transform = createStaffPadChangeSpeedTransform({ rate: 2 ** (Number(normalized.pitchShift) / 12) });
	for (let echo = 1; echo <= echoes; echo++) {
		if (context.isCancelled?.()) throw new DOMException('Delay rendering was cancelled.', 'AbortError');
		const frames = Math.max(1, Math.round(echoSource[0].length * transform.durationRatio));
		const shifted = channels.map(() => new Float32Array(frames));
		for (let group = 0; group < channels.length; group += 2) {
			await renderStaffPad({ channels: echoSource.slice(group, group + 2), sampleRate, transform }, runtime, {
				isCancelled: context.isCancelled,
				onChunk(chunk: Float32Array[], offset: number): void {
					for (let channel = 0; channel < chunk.length; channel++) shifted[group + channel].set(chunk[channel], offset);
				},
			});
		}
		echoSource = shifted;
		const start = delayEchoOffsetFrames(normalized, sampleRate, echo);
		const gain = Number(normalized.mix) * 10 ** (Number(normalized.echoGain) * echo / 20);
		for (let channel = 0; channel < channels.length; channel++) {
			const retained = Math.min(shifted[channel].length, output[channel].length - start);
			for (let frame = 0; frame < retained; frame++) output[channel][start + frame] += shifted[channel][frame] * gain;
		}
	}
	return output;
}
