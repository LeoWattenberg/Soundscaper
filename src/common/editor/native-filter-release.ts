/* SPDX-License-Identifier: AGPL-3.0-only */

import { iirReleaseBoundFrames, type NormalizedIirCoefficients } from './iir-release-bound.ts';

interface NativeFilterEffect {
	readonly id: string;
	readonly type: string;
	readonly params: Readonly<Record<string, unknown>>;
}

/** The native low/high-pass controls author a quality factor. The browser's
 * dB conversion has already been applied when it computes these coefficients.
 */
export function nativeFilterTailFrames(effect: NativeFilterEffect, sampleRate: number,
	automationLanes: readonly unknown[] = []): number | null {
	if (effect.type !== 'lowpass' && effect.type !== 'highpass') return null;
	const frequencies = parameterBounds(effect, 'frequency', automationLanes);
	const qualities = parameterBounds(effect, 'q', automationLanes);
	const minimumFrequency = Math.min(sampleRate / 2, Math.max(10, frequencies[0]));
	const maximumFrequency = Math.min(sampleRate / 2, Math.max(10, frequencies[1]));
	if (minimumFrequency >= sampleRate / 2) return 0;
	// A curve approaching the native Nyquist endpoint can have arbitrarily
	// slow poles, even though the exact endpoint is an identity/zero filter.
	if (maximumFrequency >= sampleRate / 2) return Number.MAX_SAFE_INTEGER;
	let tail = 0;
	for (const frequency of [minimumFrequency, maximumFrequency]) {
		for (const quality of qualities) {
			const angle = 2 * Math.PI * frequency / sampleRate;
			const cosine = Math.cos(angle);
			const alpha = Math.sin(angle) / (2 * Math.max(.0001, quality));
			const a0 = 1 + alpha;
			const b0 = (effect.type === 'lowpass' ? 1 - cosine : 1 + cosine) / (2 * a0);
			const b1 = (effect.type === 'lowpass' ? 1 - cosine : -(1 + cosine)) / a0;
			const coefficients: NormalizedIirCoefficients = [b0, b1, b0, -2 * cosine / a0, (1 - alpha) / a0];
			tail = Math.max(tail, iirReleaseBoundFrames([coefficients]));
		}
	}
	return tail;
}

function parameterBounds(effect: NativeFilterEffect, parameterId: 'frequency' | 'q',
	lanes: readonly unknown[]): readonly [number, number] {
	const values = [Number(effect.params[parameterId])];
	for (const value of lanes) {
		const lane = record(value);
		const address = record(lane?.address);
		if (address?.kind !== 'effect' || address.effectId !== effect.id || address.parameterId !== parameterId
			|| !Array.isArray(lane?.points) || lane.points.length === 0) continue;
		for (const point of lane.points) appendValue(values, record(point)?.value);
		if (!Array.isArray(lane.segments)) continue;
		for (const shape of lane.segments) {
			const segment = record(shape);
			if (segment?.kind !== 'bezier') continue;
			appendValue(values, record(segment.control1)?.value);
			appendValue(values, record(segment.control2)?.value);
		}
	}
	return [Math.min(...values), Math.max(...values)];
}

function appendValue(values: number[], value: unknown): void {
	if (typeof value === 'number' && Number.isFinite(value)) values.push(value);
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>> : null;
}
