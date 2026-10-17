/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionAudioMixBlock, MotionAudioMixer } from '../../motion-audio-contract.ts';
import { addRationals, compareRationals, divideRationals, multiplyRationals, normalizeRational, roundRational, subtractRationals, type Rational, type RationalInput } from '../../timeline-time.ts';
import { motionInteger } from '../../motion-values.ts';
import { createMotionWebAudioOutput } from './internal/motion-audio-web-output.ts';

export interface MotionAudioPlaybackOutput {
	readonly sampleRate: number; readonly currentTime: number;
	resume(): Promise<void>;
	schedule(block: MotionAudioMixBlock, when: number, ended: () => void): { stop(): void };
	close(): Promise<void>;
}
export interface MotionAudioPreviewState {
	readonly status: 'paused' | 'buffering' | 'playing' | 'ended' | 'error' | 'disposed';
	readonly position: Rational; readonly queuedBlocks: number; readonly underruns: number; readonly error: string | null;
}
export interface MotionAudioPreviewOptions {
	readonly mixer: MotionAudioMixer; readonly context?: AudioContext; readonly output?: MotionAudioPlaybackOutput;
	readonly channels?: 1 | 2; readonly blockSamples?: number; readonly maximumQueuedBlocks?: number;
	readonly onState?: (state: MotionAudioPreviewState) => void; readonly onError?: (error: Error) => void;
}
interface Playback { readonly generation: number; readonly compositionId: string; readonly start: Rational; readonly total: number; readonly cancellation: AbortController; readonly output: MotionAudioPlaybackOutput; cursor: number }
interface Scheduled { readonly offset: number; readonly count: number; readonly when: number; readonly handle: { stop(): void } }

/** Prime then schedule bounded PCM blocks. Video uses this audio sample clock, which holds during starvation. */
export function createMotionAudioPreview(options: MotionAudioPreviewOptions) {
	const blockSamples = motionInteger(options.blockSamples ?? 4096, 'audio preview block samples', 128, 65536);
	const maximumQueued = motionInteger(options.maximumQueuedBlocks ?? 3, 'audio preview queued blocks', 2, 4);
	let output = options.output;
	const channels = options.channels ?? 2; if (channels !== 1 && channels !== 2) throw new RangeError('Motion audio preview supports mono or stereo.');
	let status: MotionAudioPreviewState['status'] = 'paused'; let generation = 0; let current: Playback | null = null;
	let flight: Promise<void> | null = null; let disposed = false; let played = 0; let underruns = 0; let errorMessage: string | null = null;
	let startTime: Rational = { num: 0, den: 1 }; let scheduledUntil = 0; const queued = new Set<Scheduled>();
	const clock = { now: () => output ? samplePosition() / output.sampleRate * 1000 : 0,
		schedule: (callback: () => void, delayMs: number): unknown => setTimeout(callback, delayMs), cancel: (token: unknown) => clearTimeout(token as ReturnType<typeof setTimeout>) };
	return {
		clock,
		async play(request: Readonly<{ compositionId: string; startTime: RationalInput; endTime: RationalInput }>): Promise<void> {
			if (disposed) throw new Error('Motion audio preview is disposed.');
			const composition = options.mixer.revision.project.compositions.find((value) => value.id === request.compositionId);
			if (!composition) throw new ReferenceError(`Motion composition ${request.compositionId} is missing.`);
			const start = normalizeRational(request.startTime, { maximumDenominator: Number.MAX_SAFE_INTEGER }); const end = normalizeRational(request.endTime, { maximumDenominator: Number.MAX_SAFE_INTEGER });
			if (start.num < 0 || compareRationals(start, end) >= 0 || compareRationals(end, divideRationals(composition.durationFrames, composition.frameRate)) > 0) throw new RangeError('Motion audio playback range must fit the composition.');
			cancel(); const own = generation; status = 'buffering'; errorMessage = null; played = 0; underruns = 0; startTime = start; notify();
			if (flight) await flight.catch(() => { /* The prior generation already handled its failure or cancellation. */ }); if (disposed || own !== generation) return;
			let task: Promise<void> | null = null;
			try {
				output ??= createMotionWebAudioOutput(options.context);
				const length = multiplyRationals(subtractRationals(end, start), output.sampleRate);
				const session: Playback = { generation: own, compositionId: request.compositionId, start: multiplyRationals(start, output.sampleRate), total: roundRational(length.num, length.den, 'enclosingEnd'), cursor: 0, cancellation: new AbortController(), output };
				current = session;
				task = prime(session); flight = task; await task;
			} catch (error) { if (!disposed && own === generation) { fail(error); throw error; } }
			finally { if (task && flight === task) flight = null; }
		},
		pause() { if (!disposed) { cancel(); status = 'paused'; notify(); } },
		dispose() { if (!disposed) { cancel(); disposed = true; status = 'disposed'; notify(); void output?.close().catch((error: unknown) => options.onError?.(asError(error))); } },
		snapshot,
	};

	function samplePosition(): number {
		if (!current) return played;
		const output = current.output;
		const now = output.currentTime;
		for (const block of queued) if (now >= block.when) played = Math.max(played, block.offset + Math.min(block.count, Math.max(0, Math.floor((now - block.when) * output.sampleRate + 1e-6))));
		return played;
	}
	function snapshot(): MotionAudioPreviewState { return { status, position: output ? addRationals(startTime, divideRationals(samplePosition(), output.sampleRate)) : startTime, queuedBlocks: queued.size, underruns, error: errorMessage }; }
	function notify(): void { options.onState?.(snapshot()); }
	function valid(session: Playback): boolean { return !disposed && session === current && session.generation === generation && !session.cancellation.signal.aborted; }
	function cancel(): void { samplePosition(); generation++; current?.cancellation.abort(); current = null; for (const item of queued) item.handle.stop(); queued.clear(); }
	function fail(value: unknown): void { const error = asError(value); cancel(); status = 'error'; errorMessage = error.message; notify(); options.onError?.(error); }
	async function mixNext(session: Playback): Promise<MotionAudioMixBlock> {
		const output = session.output;
		const sampleCount = Math.min(blockSamples, session.total - session.cursor);
		const block = await options.mixer.mixBlock({ compositionId: session.compositionId, startSample: addRationals(session.start, session.cursor), sampleRate: output.sampleRate, sampleCount, channels }, session.cancellation.signal);
		if (block.revisionDigest !== options.mixer.revision.digest || block.sampleCount !== sampleCount || block.sampleRate !== output.sampleRate || block.channels !== channels
			|| block.interleaved.length !== sampleCount * channels || compareRationals(block.startSample, addRationals(session.start, session.cursor)) !== 0) throw new Error('Motion audio preview received a stale or malformed mix block.');
		session.cursor += sampleCount; return block;
	}
	async function prime(session: Playback): Promise<void> {
		const output = session.output;
		await output.resume(); if (!valid(session)) return;
		const ready: MotionAudioMixBlock[] = [];
		while (valid(session) && ready.length < maximumQueued && session.cursor < session.total) ready.push(await mixNext(session));
		if (!valid(session)) return;
		scheduledUntil = output.currentTime + 0.05; let offset = 0;
		for (const block of ready) { schedule(session, block, offset); offset += block.sampleCount; }
		status = 'playing'; notify();
	}
	function schedule(session: Playback, block: MotionAudioMixBlock, offset: number): void {
		const output = session.output;
		const when = scheduledUntil;
		const handle = output.schedule(block, when, () => {
			if (!valid(session)) return;
			played = Math.max(played, offset + block.sampleCount); queued.delete(item); item.handle.stop();
			if (session.cursor >= session.total && queued.size === 0) { status = 'ended'; current = null; notify(); }
			else { notify(); pump(session); }
		});
		const item: Scheduled = { offset, count: block.sampleCount, when, handle }; queued.add(item); scheduledUntil += block.sampleCount / output.sampleRate;
	}
	function pump(session: Playback): void {
		if (flight || !valid(session)) return;
		const task = refill(session); flight = task;
		void task.catch((error: unknown) => { if (valid(session)) fail(error); }).finally(() => { if (flight === task) flight = null; });
	}
	async function refill(session: Playback): Promise<void> {
		const output = session.output;
		while (valid(session) && queued.size < maximumQueued && session.cursor < session.total) {
			const offset = session.cursor; const block = await mixNext(session); if (!valid(session)) return;
			if (scheduledUntil < output.currentTime) { underruns++; scheduledUntil = output.currentTime + 0.02; }
			schedule(session, block, offset); notify();
		}
	}
}
function asError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
