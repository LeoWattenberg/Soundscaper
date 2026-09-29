/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MixerEdgeV21 } from '../mixer-graph-v21.ts';

/** Explicit maps preserve V21 mono-panner widening and ignore surplus entries. */
export function parallelChannelMatrix(edge: MixerEdgeV21, sourceWidth: number,
	declaredWidth: number, destinationWidth: number): readonly (readonly number[])[] {
	const rows = Array.from({ length: destinationWidth }, () => Array<number>(sourceWidth).fill(0));
	if (edge.channelMap.length) {
		for (let destination = 0; destination < Math.min(destinationWidth, edge.channelMap.length); destination++) {
			let source = edge.channelMap[destination]!;
			if (sourceWidth !== declaredWidth && source === 0 && destination < sourceWidth) source = destination;
			if (source >= sourceWidth) throw new Error(`Parallel edge ${edge.id} maps a missing source channel.`);
			if (source >= 0) rows[destination]![source] = 1;
		}
	} else if (sourceWidth === destinationWidth) {
		for (let c = 0; c < sourceWidth; c++) rows[c]![c] = 1;

	} else {
		// The current GainNode graph carries dynamic widths for empty maps. Its
		// panner can see mono or stereo depending on upstream racks, so do not
		// substitute a declared-width speaker conversion here.
		throw new Error(`Parallel edge ${edge.id} needs an explicit map for this channel layout.`);
	}
	return rows;
}

/** A fixed integer delay. The destination task alone owns and advances it. */
export class ParallelStackDelay {
	readonly #rings: Float32Array[];
	#cursor = 0;
	constructor(readonly frames: number, channels: number) {
		this.#rings = Array.from({ length: channels }, () => new Float32Array(frames));
	}
	process(channels: readonly Float32Array[], count: number): void {
		if (this.frames === 0) return;
		for (let frame = 0; frame < count; frame++) {
			for (let channel = 0; channel < channels.length; channel++) {
				const old = this.#rings[channel]![this.#cursor]!;
				this.#rings[channel]![this.#cursor] = channels[channel]![frame]!;
				channels[channel]![frame] = old;
			}
			this.#cursor = (this.#cursor + 1) % this.frames;
		}
	}
}

/** StereoPannerNode equal-power equations, with separate float gain stages. */
export function parallelStripControls(input: readonly Float32Array[], output: readonly Float32Array[],
	frames: number, gain: number, pan: number, gate: number, vca: number): void {
	if (input.length <= 2) {
		const angle = (input.length === 1 ? (pan + 1) * .5 : pan <= 0 ? pan + 1 : pan) * Math.PI * .5;
		const leftGain = Math.cos(angle);
		const rightGain = Math.sin(angle);
		for (let frame = 0; frame < frames; frame++) {
			const left = Math.fround(input[0]![frame]! * gain);
			const right = input.length === 1 ? left : Math.fround(input[1]![frame]! * gain);
			const outLeft = input.length === 1 ? left * leftGain : pan <= 0 ? left + right * leftGain : left * leftGain;
			const outRight = input.length === 1 ? right * rightGain : pan <= 0 ? right * rightGain : right + left * rightGain;
			output[0]![frame] = Math.fround(Math.fround(outLeft) * gate) * vca;
			output[1]![frame] = Math.fround(Math.fround(outRight) * gate) * vca;
		}
		return;
	}
	for (let c = 0; c < input.length; c++) for (let f = 0; f < frames; f++) {
		output[c]![f] = Math.fround(Math.fround(input[c]![f]! * gain) * gate) * vca;
	}
}
