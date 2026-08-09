/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeRational, type RationalRate } from './timeline-time.ts';
import {
	decodeVideoTimingAsset,
	encodeVideoTimingAsset,
	type VideoTimingAssetInput,
	type VideoTimingIndex,
} from './video-timing-asset.ts';

export interface VideoTimingProbeResult extends VideoTimingAssetInput {
	readonly nominalRate: RationalRate;
}

export interface VideoTimingProbePort {
	readonly id: string;
	probe(input: Blob, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<VideoTimingProbeResult>;
}

export type ResolvedVideoTimingProbe =
	| Readonly<{
		decision: 'timing-asset';
		backend: string;
		nominalRate: RationalRate;
		timing: VideoTimingIndex;
	}>
	| Readonly<{
		decision: 'conform-cfr-at-ingest';
		rate: RationalRate;
		reason: 'timing-probe-unavailable';
		failures: readonly Readonly<{ backend: string; message: string }>[];
	}>;

export interface VideoTimingProbeOptions {
	readonly probes?: readonly VideoTimingProbePort[];
	readonly fallbackRate?: RationalRate;
	readonly signal?: AbortSignal;
}

/** Try exact runtime probes in preference order and persist an explicit CFR fallback decision. */
export async function probeVideoTiming(
	input: Blob,
	options: VideoTimingProbeOptions = {},
): Promise<ResolvedVideoTimingProbe> {
	if (!(input instanceof Blob)) throw new TypeError('A video Blob is required for timing probe.');
	const failures: Array<Readonly<{ backend: string; message: string }>> = [];
	for (const probe of options.probes ?? []) {
		if (!probe || typeof probe.id !== 'string' || !probe.id || typeof probe.probe !== 'function') {
			throw new TypeError('Every video timing probe requires an ID and probe function.');
		}
		throwIfAborted(options.signal);
		try {
			const candidate = await probe.probe(input, { signal: options.signal });
			throwIfAborted(options.signal);
			const nominalRate = normalizeRate(candidate.nominalRate);
			const timing = decodeVideoTimingAsset(encodeVideoTimingAsset(candidate));
			return Object.freeze({ decision: 'timing-asset', backend: probe.id, nominalRate, timing });
		} catch (error) {
			throwIfAborted(options.signal);
			failures.push(Object.freeze({
				backend: probe.id,
				message: error instanceof Error ? error.message : String(error),
			}));
		}
	}
	return Object.freeze({
		decision: 'conform-cfr-at-ingest',
		rate: normalizeRate(options.fallbackRate ?? { num: 30, den: 1 }),
		reason: 'timing-probe-unavailable',
		failures: Object.freeze(failures),
	});
}

/** Adapter for a demuxing WebCodecs integration that exposes integer timestamps. */
export function createWebCodecsVideoTimingProbe(
	probe: VideoTimingProbePort['probe'],
): VideoTimingProbePort {
	if (typeof probe !== 'function') throw new TypeError('A WebCodecs timing demuxer is required.');
	return Object.freeze({ id: 'webcodecs', probe });
}

/** Adapter for an FFmpeg runtime exposing the bounded timing-probe port. */
export function createFfmpegVideoTimingProbe(runtime: Readonly<{
	probeVideoTiming?: VideoTimingProbePort['probe'];
}>): VideoTimingProbePort | null {
	return typeof runtime?.probeVideoTiming === 'function'
		? Object.freeze({ id: 'ffmpeg', probe: runtime.probeVideoTiming.bind(runtime) })
		: null;
}

function normalizeRate(rate: RationalRate): RationalRate {
	const normalized = normalizeRational(rate);
	if (normalized.num <= 0) throw new RangeError('A positive nominal video rate is required.');
	return normalized;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('Video timing probe was cancelled.', 'AbortError');
}
