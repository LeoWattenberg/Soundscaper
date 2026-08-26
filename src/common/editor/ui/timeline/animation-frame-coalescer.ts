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
