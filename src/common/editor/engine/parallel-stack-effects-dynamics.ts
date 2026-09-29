/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ParallelStackEffectProcessor } from './parallel-stack-effects.ts';

/** Exact dynamics-worklet.js recurrence, with rings reserved before processing. */
export function createParallelDynamics(type: string, params: Readonly<Record<string, unknown>>,
	sampleRate: number, channels: number): ParallelStackEffectProcessor {
	const limiter = type === 'limiter';
	const db = (value: unknown, fallback: number) => 10 ** (Number(value ?? fallback) / 20);
	const coefficient = (value: unknown, fallback: number) => Number(value ?? fallback) > 0
		? Math.exp(-1 / (Number(value ?? fallback) * sampleRate)) : 0;
	const threshold = db(params.threshold, -50);
	const closed = db(params.rangeDb, -80);
	const ceiling = db(params.ceiling, -1);
	const attack = coefficient(params.attack, .005);
	const release = coefficient(params.release, .1);
	const hold = Math.max(0, Math.round(Number(params.hold ?? 0) * sampleRate));
	const length = Math.max(1, Math.ceil(Number(params.lookahead ?? 0) * sampleRate) + 1);
	const rings = Array.from({ length: channels }, () => new Float32Array(limiter ? length : 0));
	let envelope = limiter ? 1 : closed;
	let held = 0;
	let cursor = 0;
	return { reset() {
		envelope = limiter ? 1 : closed; held = 0; cursor = 0;
		for (const ring of rings) ring.fill(0);
	}, processBlock(input, output, frames, sidechain) {
		const detector = sidechain ?? input;
		for (let frame = 0; frame < frames; frame++) {
			let peak = 0;
			for (const channel of detector) peak = Math.max(peak, Math.abs(channel[frame] || 0));
			if (limiter) {
				for (let c = 0; c < channels; c++) rings[c]![cursor] = input[c]?.[frame] || 0;
				const target = peak > ceiling && peak > 0 ? ceiling / peak : 1;
				envelope = target < envelope ? target : 1 + release * (envelope - 1);
				const read = (cursor + 1) % length;
				for (let c = 0; c < channels; c++) output[c]![frame] = Math.max(-ceiling, Math.min(ceiling, rings[c]![read]! * envelope));
				cursor = read;
			} else {
				if (peak >= threshold) held = hold;
				else if (held > 0) held--;
				const target = peak >= threshold || held > 0 ? 1 : closed;
				envelope = target + (target > envelope ? attack : release) * (envelope - target);
				for (let c = 0; c < channels; c++) output[c]![frame] = (input[c]?.[frame] || 0) * envelope;
			}
		}
	} };
}
