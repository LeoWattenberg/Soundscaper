/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeMotionCompositionOffer, type MotionCompositionOffer } from './motion-link-protocol.ts';
import { createMotionAudioMixer } from './motion-audio-mixer.ts';
import { normalizeMotionAudioBlockRequest, type MotionAudioMixer, type MotionAudioSampleProvider } from './motion-audio-contract.ts';
import type { MotionExpressionAudioPreparation } from './motion-expression-audio-preparation.ts';
import { requireMotionTrackingReady } from './motion-tracking-admission.ts';
import { motionInteger } from './motion-values.ts';
import { divideRationals, multiplyRationals, normalizeRational, type Rational, type RationalInput } from './timeline-time.ts';
import { aggregateScapeErrors } from './scape-abort.ts';
export interface MotionCompositionLinkAudioLease {
	readonly provider: MotionAudioSampleProvider; readonly expressionAudio?: MotionExpressionAudioPreparation;
	/** Release retained original bytes and provider handles after the final in-flight block is cancelled or finished. */
	release(): Promise<void>;
}
export interface MotionCompositionLinkAudioRequest {
	readonly sourceTime: RationalInput; readonly sampleRate: number; readonly sampleCount: number; readonly channels: 1 | 2;
}
export interface MotionCompositionLinkAudioBlock extends Omit<MotionCompositionLinkAudioRequest, 'sourceTime'> {
	readonly identity: Readonly<{ projectId: string; compositionId: string; revisionDigest: string }>;
	readonly sourceTime: Rational; readonly interleaved: Float32Array;
}
export interface MotionCompositionLinkAudioSource {
	readonly offer: MotionCompositionOffer; readonly identity: MotionCompositionLinkAudioBlock['identity'];
	readonly duration: Rational; readonly nativeSampleRate: number;
	read(request: MotionCompositionLinkAudioRequest, signal?: AbortSignal): Promise<MotionCompositionLinkAudioBlock>;
	snapshot(): Readonly<{ cacheBytes: number; cacheWindows: number; rendering: boolean; disposed: boolean }>;
	dispose(): Promise<void>;
}
export interface MotionCompositionLinkAudioOptions {
	/** A partial failed acquisition cleans itself up. Successful acquisition retains this exact saved closure until release. */
	readonly acquire: (offer: MotionCompositionOffer, signal?: AbortSignal) => Promise<MotionCompositionLinkAudioLease>;
	readonly maximumCacheBytes?: number; readonly maximumBlockSamples?: number; readonly maximumEvaluatedOccurrences?: number;
}

/** Pinned source PCM at sourceTime+i/sampleRate. Frame trim, reverse and pitch policy remain with its exact source addressing. */
export function createMotionCompositionLinkAudioSource(value: unknown, options: MotionCompositionLinkAudioOptions): MotionCompositionLinkAudioSource {
	const offer = normalizeMotionCompositionOffer(value); requireMotionTrackingReady(offer.revision.project);
	if (typeof options.acquire !== 'function') throw new TypeError('A retained linked-audio acquisition is required.');
	const maximumBlockSamples = motionInteger(options.maximumBlockSamples ?? 4096, 'linked maximum audio block samples', 1, 4096);
	const maximumCacheBytes = motionInteger(options.maximumCacheBytes ?? 16 * 1024 * 1024, 'linked audio cache bytes', 32768, 256 * 1024 * 1024);
	const maximumEvaluatedOccurrences = motionInteger(options.maximumEvaluatedOccurrences ?? 4_194_304, 'linked audio evaluated occurrences', 3, 16_777_216);
	const identity = Object.freeze({ projectId: offer.revision.projectId, compositionId: offer.compositionId, revisionDigest: offer.revision.digest });
	const duration = Object.freeze(divideRationals(offer.output.durationFrames, offer.output.frameRate)); const disposal = new AbortController();
	let mixer: MotionAudioMixer | null = null, lease: MotionCompositionLinkAudioLease | null = null;
	let active: Promise<MotionCompositionLinkAudioBlock> | null = null, closing: Promise<void> | null = null; let disposed = false;
	async function prepare(signal: AbortSignal): Promise<MotionAudioMixer> {
		if (mixer) return mixer;
		const retained = await options.acquire(offer, signal);
		try {
			signal.throwIfAborted();
			const candidate = createMotionAudioMixer({ project: offer.revision.project, provider: retained.provider, expressionAudio: retained.expressionAudio, maximumBlockSamples, maximumCacheBytes, maximumEvaluatedOccurrences });
			mixer = candidate; lease = retained; return candidate;
		} catch (error) {
			const failures: unknown[] = []; try { await retained.release(); } catch (failure) { failures.push(failure); }
			throw aggregateScapeErrors(error, failures, 'Linked audio acquisition and closure release failed.');
		}
	}
	return {
		offer, identity, duration, nativeSampleRate: offer.revision.project.sampleRate,
		async read(value, externalSignal) {
			if (disposed) throw new Error('Motion linked audio source is disposed.'); if (active) throw new Error('Motion linked audio source already has one block in flight.');
			const sourceTime = Object.freeze(normalizeRational(value.sourceTime, { maximumDenominator: Number.MAX_SAFE_INTEGER }));
			const request = normalizeMotionAudioBlockRequest({ compositionId: offer.compositionId, startSample: multiplyRationals(sourceTime, value.sampleRate), sampleRate: value.sampleRate, sampleCount: value.sampleCount, channels: value.channels }, maximumBlockSamples);
			const signal = externalSignal ? AbortSignal.any([externalSignal, disposal.signal]) : disposal.signal; signal.throwIfAborted();
			const operation = (async () => {
				const retained = await prepare(signal); signal.throwIfAborted();
				// The shared evaluator supplies silence outside the composition and exact nested timing inside it.
				const block = await retained.mixBlock(request, signal); signal.throwIfAborted();
				return Object.freeze({ identity, sourceTime, sampleRate: request.sampleRate, sampleCount: request.sampleCount, channels: request.channels, interleaved: block.interleaved });
			})();
			active = operation; try { return await operation; } finally { if (active === operation) active = null; }
		},
		snapshot: () => ({ cacheBytes: mixer?.snapshot().cacheBytes ?? 0, cacheWindows: mixer?.snapshot().cacheWindows ?? 0, rendering: active !== null, disposed }),
		dispose() {
			if (closing) return closing; disposed = true; disposal.abort();
			closing = (async () => {
				await active?.catch(() => undefined); const retained = lease; lease = null; const previous = mixer; mixer = null;
				try { previous?.dispose(); } finally { await retained?.release(); }
			})(); return closing;
		},
	};
}
