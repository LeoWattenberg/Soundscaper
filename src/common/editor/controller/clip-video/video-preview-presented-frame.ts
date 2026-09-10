/* SPDX-License-Identifier: AGPL-3.0-only */

export interface VideoPreviewPresentedFrameSource {
	readonly requestVideoFrameCallback?: (callback: VideoFrameRequestCallback) => number;
	readonly cancelVideoFrameCallback?: (handle: number) => void;
}

export interface VideoPreviewPresentedFrameGate {
	request(
		source: VideoPreviewPresentedFrameSource,
		presentationKey: object,
		onPresented: () => void,
	): void;
	cancel(): void;
}

interface PendingPresentedFrame {
	readonly source: VideoPreviewPresentedFrameSource;
	readonly presentationKey: object;
	readonly cancel: (handle: number) => void;
	id: number | null;
}

/** Coalesce media readiness behind the browser's first authenticated picture. */
export function createVideoPreviewPresentedFrameGate(): VideoPreviewPresentedFrameGate {
	let pending: PendingPresentedFrame | null = null;
	const cancel = (): void => {
		const current = pending;
		if (current === null) return;
		pending = null;
		if (current.id === null) return;
		try {
			current.cancel.call(current.source, current.id);
		} catch { /* the media element can already be detached */ }
	};
	const request = (
		source: VideoPreviewPresentedFrameSource,
		presentationKey: object,
		onPresented: () => void,
	): void => {
		if (pending?.source === source && pending.presentationKey === presentationKey) return;
		cancel();
		const requestPresentedFrame = source.requestVideoFrameCallback;
		const cancelPresentedFrame = source.cancelVideoFrameCallback;
		if (typeof requestPresentedFrame !== 'function'
			|| typeof cancelPresentedFrame !== 'function') {
			onPresented();
			return;
		}
		const requested: PendingPresentedFrame = {
			source, presentationKey, cancel: cancelPresentedFrame, id: null,
		};
		let presentedSynchronously = false;
		try {
			const id = requestPresentedFrame.call(source, () => {
				if (requested.id === null) {
					presentedSynchronously = true;
					onPresented();
					return;
				}
				if (pending !== requested) return;
				pending = null;
				onPresented();
			});
			requested.id = id;
			if (!presentedSynchronously) pending = requested;
		} catch {
			if (!presentedSynchronously) onPresented();
		}
	};
	return Object.freeze({ request, cancel });
}
