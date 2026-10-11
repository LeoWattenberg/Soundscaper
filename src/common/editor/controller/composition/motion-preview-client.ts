/* SPDX-License-Identifier: AGPL-3.0-only */

import { planMotionTemporalSamples, type MotionPreviewQuality } from '../../motion-temporal-sampling.ts';
import { normalizeMotionscaperProject } from '../../motion-project-validation.ts';
import type { MotionscaperProject } from '../../motion-project-types.ts';
import { addRationals, compareRationals, divideRationals, normalizeRational, type Rational } from '../../timeline-time.ts';
import { createMotionPreviewCache } from './internal/motion-preview-cache.ts';
import type { MotionPreviewClient, MotionPreviewFrame, MotionPreviewOptions, MotionPreviewState } from './motion-preview-types.ts';

interface PreviewJob { readonly compositionId: string; readonly time: Rational; readonly generation: number; readonly quality: MotionPreviewQuality; resolve(): void; reject(error: unknown): void }
interface Playback { readonly compositionId: string; readonly start: Rational; readonly end: Rational; readonly rate: Rational; readonly startedMs: number; readonly quality: MotionPreviewQuality; index: number }

/** One in-flight render and one replaceable pending seek; superseded work cannot publish pixels. */
export async function createMotionPreviewClient(options: MotionPreviewOptions): Promise<MotionPreviewClient> {
	const cache = createMotionPreviewCache(options.maximumCacheBytes ?? 32 * 1024 * 1024);
	const backend = await (options.backendFactory ? options.backendFactory() : import('./motion-preview-backend.ts').then((module) => module.createMotionPreviewBackend(options)));
	const clock = options.clock ?? { now: () => performance.now(), schedule: (callback: () => void, delay: number) => setTimeout(callback, delay), cancel: (token: unknown) => clearTimeout(token as ReturnType<typeof setTimeout>) };
	let project: MotionscaperProject | null = null; let disposed = false; let generation = 0;
	let flight: Promise<void> | null = null; let pending: PreviewJob | null = null;
	let renderAbort: AbortController | null = null; let loadingAbort: AbortController | null = null;
	let playback: Playback | null = null; let timer: unknown = null;
	let state: MotionPreviewState = Object.freeze({ status: 'idle', compositionId: null, time: null, backend: null, error: null, cacheBytes: 0, generation });
	const client: MotionPreviewClient = {
		async setProject(value, loadAsset, decodeFootage) {
			assertActive(); const normalized = normalizeMotionscaperProject(value);
			invalidate(); const own = generation; project = null; cache.clear();
			const cancellation = new AbortController(); loadingAbort = cancellation;
			update({ status: 'loading', error: null, compositionId: null, time: null });
			try {
				await flight;
				if (own !== generation || disposed) return;
				const name = await backend.setProject(normalized, loadAsset, cancellation.signal, decodeFootage);
				if (own !== generation || disposed) return;
				project = normalized; update({ status: 'paused', backend: name });
			} catch (error) { if (own === generation && !disposed) { report(error); throw error; } }
			finally { if (loadingAbort === cancellation) loadingAbort = null; }
		},
		async seek(request) {
			const composition = assertProject(request.compositionId); const time = normalizeRational(request.time, { maximumDenominator: Number.MAX_SAFE_INTEGER });
			const quality = qualityFor(composition, time, request.quality);
			invalidate(); update({ status: 'rendering', error: null });
			return enqueue(request.compositionId, time, quality);
		},
		play(request) {
			const composition = assertProject(request.compositionId);
			const start = normalizeRational(request.startTime, { maximumDenominator: Number.MAX_SAFE_INTEGER });
			const end = normalizeRational(request.endTime, { maximumDenominator: Number.MAX_SAFE_INTEGER });
			if (start.num < 0 || compareRationals(start, end) >= 0 || compareRationals(end, divideRationals(composition.durationFrames, composition.frameRate)) > 0) throw new RangeError('Motion preview playback range must fit the composition.');
			const quality = qualityFor(composition, start, request.quality);
			invalidate(); playback = { quality, compositionId: request.compositionId, start, end, rate: composition.frameRate, startedMs: clock.now(), index: -1 };
			update({ status: 'playing', error: null }); schedulePlayback();
		},
		pause() { if (!disposed) { invalidate(); update({ status: project ? 'paused' : 'idle' }); } },
		dispose() { if (!disposed) { invalidate(); disposed = true; project = null; cache.clear(); backend.dispose(); update({ status: 'disposed' }); } },
		snapshot: () => state,
	};
	return client;

	function assertActive(): void { if (disposed) throw new Error('Motion preview is disposed.'); }
	function assertProject(id: string) {
		assertActive(); if (!project) throw new Error('Load a motion project before previewing.');
		const composition = project.compositions.find((value) => value.id === id); if (!composition) throw new ReferenceError(`Motion composition ${id} is missing.`);
		return composition;
	}
	function update(patch: Partial<MotionPreviewState>): void {
		state = Object.freeze({ ...state, ...patch, generation, cacheBytes: cache.byteLength }); options.onState(state);
	}
	function invalidate(): void {
		generation++; playback = null;
		if (timer !== null) { clock.cancel(timer); timer = null; }
		loadingAbort?.abort(); renderAbort?.abort(); pending?.resolve(); pending = null;
	}
	function qualityFor(composition: ReturnType<typeof assertProject>, time: Rational, quality?: MotionPreviewQuality): MotionPreviewQuality {
		const plan = planMotionTemporalSamples(composition, time, quality); return Object.freeze({ temporalSamples: plan.samples.length, ...(plan.depthOfFieldSampleLimit === undefined ? {} : { depthOfFieldSamples: plan.depthOfFieldSampleLimit }) });
	}
	function enqueue(compositionId: string, time: Rational, quality: MotionPreviewQuality): Promise<void> {
		return new Promise((resolve, reject) => { pending?.resolve(); pending = { compositionId, time, quality, generation, resolve, reject }; pump(); });
	}
	function pump(): void {
		if (flight || !pending || disposed) return;
		const job = pending; pending = null;
		flight = run(job).finally(() => { flight = null; if (pending) pump(); else if (playback && !disposed) schedulePlayback(); });
	}
	async function run(job: PreviewJob): Promise<void> {
		const cancellation = new AbortController(); renderAbort = cancellation;
		const key = `${job.compositionId}:${job.time.num}/${job.time.den}:${job.quality.temporalSamples}:${job.quality.depthOfFieldSamples}`;
		try {
			let frame = cache.get(key, job.generation);
			if (!frame) {
				frame = await backend.render({ compositionId: job.compositionId, time: job.time, generation: job.generation, quality: job.quality }, cancellation.signal);
				if (job.generation !== generation || disposed) { job.resolve(); return; }
				validateFrame(frame, job); cache.put(key, frame);
			}
			if (job.generation === generation && !disposed) {
				options.onFrame(frame); update({ status: playback ? 'playing' : 'paused', compositionId: frame.compositionId, time: frame.time, backend: frame.backend });
			}
			job.resolve();
		} catch (error) {
			if (job.generation !== generation || disposed || cancellation.signal.aborted) job.resolve();
			else { playback = null; report(error); job.reject(error); }
		} finally { if (renderAbort === cancellation) renderAbort = null; }
	}
	function validateFrame(frame: MotionPreviewFrame, job: PreviewJob): void {
		const composition = assertProject(job.compositionId);
		if (frame.compositionId !== job.compositionId || frame.generation !== job.generation || frame.revision !== project!.revision || compareRationals(frame.time, job.time) !== 0
			|| frame.width !== composition.width || frame.height !== composition.height || !(frame.rgba instanceof Uint8ClampedArray) || frame.rgba.byteLength !== frame.width * frame.height * 4) throw new Error('Motion preview backend returned a stale or malformed frame.');
	}
	function report(value: unknown): void {
		const error = value instanceof Error ? value : new Error(String(value)); update({ status: 'error', error: error.message }); options.onError?.(error);
	}
	function schedulePlayback(): void {
		const current = playback; if (!current || disposed || flight || pending) return;
		const elapsed = Math.max(0, clock.now() - current.startedMs);
		const index = Math.floor(elapsed * current.rate.num / (1000 * current.rate.den));
		if (index <= current.index) {
			const delay = (current.index + 1) * 1000 * current.rate.den / current.rate.num - elapsed;
			timer = clock.schedule(() => { timer = null; schedulePlayback(); }, Math.max(1, delay)); return;
		}
		const time = addRationals(current.start, divideRationals(index, current.rate));
		if (compareRationals(time, current.end) >= 0) { playback = null; update({ status: 'paused' }); return; }
		current.index = index; void enqueue(current.compositionId, time, current.quality).catch(() => { /* The current render already reported its diagnostic. */ });
	}
}
