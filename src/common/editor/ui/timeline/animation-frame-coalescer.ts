/* SPDX-License-Identifier: AGPL-3.0-only */

export interface AnimationFrameCoalescer {
	dispose(): void;
	schedule(): void;
}

export function createAnimationFrameCoalescer(
	requestFrame: (callback: FrameRequestCallback) => number,
	cancelFrame: (frame: number) => void,
	draw: FrameRequestCallback,
): AnimationFrameCoalescer {
	let frame: number | null = null;
	let disposed = false;
	return {
		dispose() {
			disposed = true;
			if (frame === null) return;
			cancelFrame(frame);
			frame = null;
		},
		schedule() {
			if (disposed || frame !== null) return;
			frame = requestFrame((time) => {
				frame = null;
				if (!disposed) draw(time);
			});
		},
	};
}

/** Retain the latest input, with a synchronous final flush before ownership ends. */
export function createLatestFrameTask<Value>(
	requestFrame: (callback: FrameRequestCallback) => number,
	cancelFrame: (frame: number) => void,
	run: (value: Value) => void,
) {
	let pending: Readonly<{ value: Value }> | null = null;
	let frame: number | null = null;
	let disposed = false;
	const flush = (cancel = false) => {
		if (frame !== null) cancelFrame(frame);
		frame = null;
		const latest = pending;
		pending = null;
		if (!cancel && !disposed && latest) run(latest.value);
	};
	return {
		flush,
		schedule(value: Value) {
			if (disposed) return;
			pending = { value };
			if (frame !== null) return;
			frame = requestFrame(() => { frame = null; flush(); });
		},
		dispose() { flush(true); disposed = true; },
	};
}
