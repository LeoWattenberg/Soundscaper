/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Wait inside the page for one complete preview sample. A looped source lets a
 * slow renderer collect enough intervals to report the actual threshold
 * failure; a stopped transport or stalled compositor instead fails promptly
 * with the retained partial count.
 */
export function waitForPreviewFrameSample(canvas, {
	transportButton,
	frameCount,
	pollIntervalMs,
	stallTimeoutMs,
}) {
	const scope = canvas?.ownerDocument?.defaultView ?? globalThis;
	const timestamps = scope.__soundscaperPreviewFrameTimes;
	if (!Array.isArray(timestamps)) throw new Error('Preview frame instrumentation is unavailable.');
	let lastCount = timestamps.length;
	let lastProgressAt = performance.now();
	let observedPlaying = transportButton?.getAttribute?.('aria-pressed') === 'true';
	return new Promise((resolve, reject) => {
		const finish = (error = null) => {
			scope.__soundscaperMeasurePreviewFrames = false;
			if (error) {
				reject(error);
				return;
			}
			const sample = timestamps.slice(0, frameCount);
			timestamps.length = 0;
			resolve(sample);
		};
		const poll = () => {
			const count = timestamps.length;
			if (count >= frameCount) {
				finish();
				return;
			}
			const now = performance.now();
			if (count > lastCount) {
				lastCount = count;
				lastProgressAt = now;
			}
			const playing = transportButton?.getAttribute?.('aria-pressed') === 'true';
			observedPlaying ||= playing;
			if (observedPlaying && !playing) {
				finish(new Error(
					`Preview frame sampling stopped with ${String(count)} of ${String(frameCount)} required final-frame draws; the benchmark source or transport ended before the sample was complete.`,
				));
				return;
			}
			if (now - lastProgressAt >= stallTimeoutMs) {
				finish(new Error(
					`Preview frame sampling stalled with ${String(count)} of ${String(frameCount)} required final-frame draws after ${String(stallTimeoutMs)} ms without compositor progress.`,
				));
				return;
			}
			setTimeout(poll, pollIntervalMs);
		};
		poll();
	});
}
