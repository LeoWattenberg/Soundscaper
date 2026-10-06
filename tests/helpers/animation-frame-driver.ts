/* SPDX-License-Identifier: AGPL-3.0-only */

/** Explicitly advance the browser frame boundary without timers or sleeps. */
export function createTestAnimationFrames() {
	const pending = new Map<number, FrameRequestCallback>();
	let nextFrame = 0;
	return {
		request(callback: FrameRequestCallback) { pending.set(++nextFrame, callback); return nextFrame; },
		cancel(frame: number) { pending.delete(frame); },
		flush() {
			const frames = [...pending.entries()];
			pending.clear();
			for (const [, callback] of frames) callback(0);
		},
	};
}
