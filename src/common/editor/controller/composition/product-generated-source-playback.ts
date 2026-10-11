/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Rational } from '../../timeline-time.ts';
export interface GeneratedSourcePlayback {
	seek(sourceFrame: number): void;
	play(sourceFrame: number): void;
	pause(): void;
	dispose(): Promise<void>;
	snapshot(): Readonly<{ playing: boolean; sourceFrame: number | null; pendingFrames: number; disposed: boolean }>;
}
type Clock = Readonly<{ now(): number; schedule(callback: () => void, delayMs: number): unknown; cancel(token: unknown): void }>;
type Options<T> = Readonly<{
	frameRate: Rational; frameCount: number;
	render(sourceFrame: number, signal: AbortSignal): Promise<T>;
	present(frame: T, sourceFrame: number): void;
	onPlayingChanged?(playing: boolean): void;
	onError?(error: unknown): void;
	clock?: Clock;
}>;
/** One in-flight render and one replaceable seek; only a painted exact ordinal advances the monitor. */
export function createGeneratedSourcePlayback<T>(options: Options<T>): GeneratedSourcePlayback {
	const { frameRate } = options;
	if (!Number.isSafeInteger(frameRate.num) || frameRate.num <= 0 || !Number.isSafeInteger(frameRate.den) || frameRate.den <= 0) throw new RangeError('Generated playback frame rate must be a positive rational.');
	if (!Number.isSafeInteger(options.frameCount) || options.frameCount <= 0) throw new RangeError('Generated playback frame count must be a positive integer.');
	const clock = options.clock ?? { now: () => performance.now(), schedule: (callback: () => void, delay: number) => setTimeout(callback, delay), cancel: token => clearTimeout(token as ReturnType<typeof setTimeout>) };
	let playing = false, disposed = false, generation = 0, originTime = 0, originFrame = 0;
	let sourceFrame: number | null = null, pending: number | null = null, active: AbortController | null = null;
	let timer: unknown = null, driving = false, tail = Promise.resolve();
	function time(): number {
		const value = clock.now(); if (!Number.isFinite(value) || value < 0 || value * 1000 > Number.MAX_SAFE_INTEGER) throw new RangeError('Generated playback clock is unavailable.'); return value;
	}
	function requireFrame(frame: number): void {
		if (disposed) throw new Error('Generated source playback is disposed.');
		if (!Number.isSafeInteger(frame) || frame < 0 || frame >= options.frameCount) throw new RangeError('Generated playback source frame is outside its retained duration.');
	}
	function clearTimer(): void { if (timer !== null) { clock.cancel(timer); timer = null; } }
	function setPlaying(value: boolean): void { if (playing !== value) { playing = value; options.onPlayingChanged?.(value); } }
	function cancel(): void {
		generation++; clearTimer(); pending = null; active?.abort(new DOMException('Generated playback request superseded.', 'AbortError'));
	}
	function failed(error: unknown): void { cancel(); setPlaying(false); options.onError?.(error); }
	function address(): Readonly<{ frame: number; ended: boolean; elapsed: number }> {
		const elapsed = time() - originTime; if (elapsed < 0) throw new RangeError('Generated playback clock must be monotonic.');
		const offset = BigInt(Math.floor(elapsed * 1000)) * BigInt(frameRate.num) / (1_000_000n * BigInt(frameRate.den));
		const ordinal = BigInt(originFrame) + offset, ended = ordinal >= BigInt(options.frameCount);
		return { frame: ended ? options.frameCount - 1 : Number(ordinal), ended, elapsed };
	}
	function schedule(): void {
		clearTimer(); if (!playing || disposed) return;
		const next = address();
		if (next.ended && sourceFrame === options.frameCount - 1) { setPlaying(false); return; }
		const delay = sourceFrame === next.frame ? Math.max(1, (next.frame - originFrame + 1) * frameRate.den * 1000 / frameRate.num - next.elapsed) : 1;
		timer = clock.schedule(tick, Math.min(1000, delay));
	}
	function tick(): void {
		timer = null; if (!playing || disposed) return;
		try {
			const next = address();
			if (next.frame === sourceFrame) schedule(); else request(next.frame);
		} catch (error) { failed(error); }
	}
	function request(frame: number): void {
		if (!active && sourceFrame === frame) { if (playing) schedule(); return; }
		pending = frame; if (driving) return;
		driving = true;
		tail = (async () => {
			while (pending !== null && !disposed) {
				const ordinal = pending, captured = generation; pending = null;
				const abort = new AbortController(); active = abort;
				try {
					const frame = await options.render(ordinal, abort.signal);
					if (disposed || abort.signal.aborted || captured !== generation) continue;
					options.present(frame, ordinal); sourceFrame = ordinal;
					if (captured === generation && playing) schedule();
				} catch (error) { if (!disposed && !abort.signal.aborted && captured === generation) failed(error); }
				finally { active = null; }
			}
		})().finally(() => {
			driving = false; const next = pending; pending = null;
			if (next !== null && !disposed) request(next);
		});
	}
	return Object.freeze({
		seek(frame: number) { requireFrame(frame); cancel(); setPlaying(false); request(frame); },
		play(frame: number) { requireFrame(frame); const now = time(); cancel(); originFrame = frame; originTime = now; setPlaying(true); request(frame); },
		pause() { if (disposed) return; cancel(); setPlaying(false); },
		dispose() { if (!disposed) { disposed = true; cancel(); setPlaying(false); } return tail; },
		snapshot: () => Object.freeze({ playing, sourceFrame, pendingFrames: (active ? 1 : 0) + (pending === null ? 0 : 1), disposed }),
	});
}
