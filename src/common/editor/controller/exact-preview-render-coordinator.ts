/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ExactPreviewRenderRequest<Frame> {
	readonly render: () => PromiseLike<Frame> | Frame;
	readonly isCurrent: () => boolean;
	readonly publish: (frame: Frame) => void;
	readonly onError: (error: unknown) => void;
}

/** Serialize exact rendering and retain redraws arriving while a frame is in flight. */
export function createExactPreviewRenderCoordinator(requestLatestFrame: () => void) {
	let active = false;
	let pending = false;
	return Object.freeze({ run, deferWhileActive });

	function deferWhileActive(): boolean {
		if (!active) return false;
		pending = true;
		return true;
	}

	async function run<Frame>(request: ExactPreviewRenderRequest<Frame>): Promise<void> {
		if (deferWhileActive()) return;
		active = true;
		try {
			const frame = await request.render();
			if (!pending && request.isCurrent()) request.publish(frame);
		} catch (error) {
			if (!pending && request.isCurrent()) request.onError(error);
		} finally {
			active = false;
			const redraw = pending || !request.isCurrent();
			pending = false;
			if (redraw) requestLatestFrame();
		}
	}
}
