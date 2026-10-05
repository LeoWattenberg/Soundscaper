/* SPDX-License-Identifier: AGPL-3.0-only */

import { setParam } from './audio-node-utils.ts';
import { ENGINE_ASSERT_ACTIVE } from './runtime-symbols.ts';
import type { EnginePlaybackFrequencyRange } from './public-api.ts';
import type { EngineRuntimeHost, EngineRuntimeMethodMap } from './runtime-types.ts';

interface ListeningOutput {
	readonly context: BaseAudioContext;
	readonly input: GainNode;
	readonly destination: AudioNode;
	readonly nodes: AudioNode[];
}

interface FrequencyAudition {
	range: EnginePlaybackFrequencyRange | null;
	output: ListeningOutput | null;
}

const auditions = new WeakMap<EngineRuntimeHost, FrequencyAudition>();
// Fourth-order Butterworth sections. Web Audio low/high pass Q is in dB.
const SECTION_Q_DB = [0.541196100146197, 1.306562964876377].map((q) => 20 * Math.log10(q));
// Two unity-peak bandpass sections together reach -3 dB at the selected edges.
const CASCADED_BANDPASS_Q_SCALE = Math.sqrt(Math.sqrt(2) - 1);

function audition(engine: EngineRuntimeHost): FrequencyAudition {
	let state = auditions.get(engine);
	if (!state) {
		state = { range: null, output: null };
		auditions.set(engine, state);
	}
	return state;
}

function normalizeRange(range: EnginePlaybackFrequencyRange | null, sampleRate: number): EnginePlaybackFrequencyRange | null {
	if (range === null) return null;
	if (!Number.isFinite(range.minimumFrequency) || !Number.isFinite(range.maximumFrequency)) {
		throw new RangeError('Playback frequencies must be finite.');
	}
	const minimumFrequency = Math.max(0, Math.min(sampleRate / 2, range.minimumFrequency));
	const maximumFrequency = Math.max(0, Math.min(sampleRate / 2, range.maximumFrequency));
	if (maximumFrequency <= minimumFrequency) throw new RangeError('Frequency audition requires a non-empty frequency range.');
	return Object.freeze({ minimumFrequency, maximumFrequency });
}

function disconnectOutput(output: ListeningOutput): void {
	output.input.disconnect();
	for (const node of output.nodes) node.disconnect();
	output.nodes.length = 0;
}

/** Prewarp the selected edges so the digital filter keeps them even near Nyquist. */
function narrowBandpassParameters(range: EnginePlaybackFrequencyRange, sampleRate: number): Readonly<{ frequency: number; q: number }> {
	const lower = Math.tan(Math.PI * range.minimumFrequency / sampleRate);
	const upper = Math.tan(Math.PI * range.maximumFrequency / sampleRate);
	const center = Math.sqrt(lower) * Math.sqrt(upper);
	return {
		frequency: sampleRate * Math.atan(center) / Math.PI,
		q: CASCADED_BANDPASS_Q_SCALE * center / (upper - lower),
	};
}

function connectOutput(output: ListeningOutput, range: EnginePlaybackFrequencyRange | null): void {
	disconnectOutput(output);
	const { context, input, destination, nodes } = output;
	let tail: AudioNode = input;
	if (range) {
		const nyquist = context.sampleRate / 2;
		if (range.minimumFrequency >= nyquist) {
			const silence = context.createGain();
			setParam(silence.gain, 0, context.currentTime);
			nodes.push(silence);
			tail.connect(silence);
			tail = silence;
		} else if (range.minimumFrequency > 0 && range.maximumFrequency < nyquist
			&& range.maximumFrequency - range.minimumFrequency < range.minimumFrequency / 2) {
			const { frequency, q } = narrowBandpassParameters(range, context.sampleRate);
			for (let section = 0; section < 2; section += 1) {
				const filter = context.createBiquadFilter();
				filter.type = 'bandpass';
				setParam(filter.frequency, frequency, context.currentTime);
				setParam(filter.Q, q, context.currentTime);
				nodes.push(filter);
				tail.connect(filter);
				tail = filter;
			}
		} else {
			const cutoffs: readonly [BiquadFilterType, number, boolean][] = [
				['highpass', range.minimumFrequency, range.minimumFrequency > 0],
				['lowpass', range.maximumFrequency, range.maximumFrequency < nyquist],
			];
			for (const [type, frequency, enabled] of cutoffs) {
				if (!enabled) continue;
				for (const q of SECTION_Q_DB) {
					const filter = context.createBiquadFilter();
					filter.type = type;
					setParam(filter.frequency, frequency, context.currentTime);
					setParam(filter.Q, q, context.currentTime);
					nodes.push(filter);
					tail.connect(filter);
					tail = filter;
				}
			}
		}
	}
	tail.connect(destination);
}

/** Attach audition only to the context's device-listening path, after project metering. */
export function connectPlaybackFrequencyOutput(
	engine: EngineRuntimeHost,
	context: BaseAudioContext,
	input: GainNode,
	destination: AudioNode,
): void {
	const state = audition(engine);
	if (state.output) disconnectOutput(state.output);
	state.output = { context, input, destination, nodes: [] };
	connectOutput(state.output, state.range);
}

/** The audition's explicit time range owns its end while the saved loop stays intact. */
export function isPlaybackLoopEnabled(engine: EngineRuntimeHost): boolean {
	return engine.loop.enabled && !auditions.get(engine)?.range;
}

/** Retire pending or active audition; subsequent normal playback hears the full mix. */
export function resetPlaybackFrequencyRange(engine: EngineRuntimeHost): void {
	const state = auditions.get(engine);
	if (!state?.range) return;
	state.range = null;
	if (state.output) connectOutput(state.output, null);
}

export function disposePlaybackFrequencyOutput(engine: EngineRuntimeHost): void {
	const state = auditions.get(engine);
	if (state?.output) disconnectOutput(state.output);
	auditions.delete(engine);
}

export const enginePlaybackFrequencyMethods = {
	setPlaybackFrequencyRange(range) {
		this[ENGINE_ASSERT_ACTIVE]();
		const normalized = normalizeRange(range, this.sampleRate);
		const state = audition(this);
		state.range = normalized;
		if (state.output) connectOutput(state.output, normalized);
		return normalized;
	},
} satisfies EngineRuntimeMethodMap<'setPlaybackFrequencyRange'>;
