/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CaptureFailure } from '../framescaper-capture-domain.ts';
import type { CapturePreviewSource } from '../platform/capture-source-port.ts';

export function installCaptureSourceEndWatchers<Stream, Track>(
	sources: readonly Readonly<CapturePreviewSource<Stream, Track>>[],
	onEnded: () => void,
): readonly (() => void)[] {
	return Object.freeze(sources.flatMap(({ track }) => {
		const eventTarget = track as Readonly<{
			addEventListener?: (type: string, listener: () => void, options?: unknown) => void;
			removeEventListener?: (type: string, listener: () => void) => void;
		}>;
		if (typeof eventTarget.addEventListener !== 'function') return [];
		eventTarget.addEventListener('ended', onEnded, { once: true });
		return [() => eventTarget.removeEventListener?.('ended', onEnded)];
	}));
}

export function captureSessionFailure(
	error: unknown,
	fallback: CaptureFailure['code'],
): Readonly<CaptureFailure> {
	const name = error && typeof error === 'object' ? (error as { readonly name?: unknown }).name : null;
	const code = name === 'NotAllowedError'
		? 'permission-denied'
		: name === 'AbortError' ? 'permission-dismissed' : fallback;
	const message = error instanceof Error ? error.message : String(error || 'Capture failed.');
	return Object.freeze({ code, message: message.slice(0, 1_024) || 'Capture failed.' });
}

export function captureSessionInputGain(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 2) {
		throw new RangeError('Capture input gain must be between zero and two.');
	}
	return value;
}

export function safelyStopCaptureClock(clock: Readonly<{ stop(nowMs: number): unknown }>, now: number): void {
	try { clock.stop(now); } catch { /* A concurrent stop already closed the clock. */ }
}

export function waitForCaptureCountdown(durationMs: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.reject(signal.reason);
	if (durationMs <= 0) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const timer = globalThis.setTimeout(resolve, durationMs);
		signal.addEventListener('abort', () => {
			globalThis.clearTimeout(timer);
			reject(signal.reason);
		}, { once: true });
	});
}
