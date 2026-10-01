/* SPDX-License-Identifier: AGPL-3.0-only */

interface FrameMetadata {
	readonly mediaTime: number;
	readonly presentedFrames: number;
}

interface VideoFrameSource {
	readonly currentTime: number;
	readonly paused: boolean;
	readonly src?: string;
	readonly currentSrc?: string;
	readonly srcObject?: unknown;
	addEventListener(type: string, listener: EventListener): void;
	removeEventListener(type: string, listener: EventListener): void;
	requestVideoFrameCallback?(callback: (now: number, metadata: FrameMetadata) => void): number;
	cancelVideoFrameCallback?(id: number): void;
}

export interface VideoPreviewFrameIdentity {
	needsUpload(): boolean;
	markUploaded(): void;
	dispose(): void;
}

const INVALIDATING_EVENTS = Object.freeze([
	'loadeddata', 'seeked', 'emptied', 'loadstart', 'resize',
]);

/** Observe injected media resources; opaque exact-render drawables remain uncached. */
export function createVideoPreviewFrameIdentity(value: unknown): VideoPreviewFrameIdentity | null {
	if (!value || typeof value !== 'object') return null;
	const source = value as Partial<VideoFrameSource>;
	if (typeof source.currentTime !== 'number' || typeof source.paused !== 'boolean'
		|| typeof source.addEventListener !== 'function' || typeof source.removeEventListener !== 'function') {
		return null;
	}
	return new PresentedFrameIdentity(source as VideoFrameSource);
}

class PresentedFrameIdentity implements VideoPreviewFrameIdentity {
	#revision = 1;
	#uploadedRevision = 0;
	#disposed = false;
	#callback: number | null = null;
	#usesCallbacks: boolean;
	#mediaTime: number | null = null;
	#presentedFrames: number | null = null;
	#observedTime: number;
	#src: string | undefined;
	#currentSrc: string | undefined;
	#srcObject: unknown;

	constructor(readonly source: VideoFrameSource) {
		this.#observedTime = source.currentTime;
		this.#src = source.src;
		this.#currentSrc = source.currentSrc;
		this.#srcObject = source.srcObject;
		this.#usesCallbacks = typeof source.requestVideoFrameCallback === 'function'
			&& typeof source.cancelVideoFrameCallback === 'function';
		for (const event of INVALIDATING_EVENTS) source.addEventListener(event, this.#invalidate);
		this.#requestFrame();
	}

	needsUpload(): boolean {
		if (this.#disposed) return true;
		const source = this.source;
		if (source.src !== this.#src || source.currentSrc !== this.#currentSrc
			|| source.srcObject !== this.#srcObject) {
			this.#src = source.src;
			this.#currentSrc = source.currentSrc;
			this.#srcObject = source.srcObject;
			this.#invalidate();
		}
		// The playback clock advances between decoded frames. Only paused seeks
		// can use it as an additional signal before seeked/frame callbacks arrive.
		if (source.paused && source.currentTime !== this.#observedTime) this.#revision += 1;
		this.#observedTime = source.currentTime;
		return (!this.#usesCallbacks && !source.paused) || this.#revision !== this.#uploadedRevision;
	}

	markUploaded(): void {
		this.#uploadedRevision = this.#revision;
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		for (const event of INVALIDATING_EVENTS) this.source.removeEventListener(event, this.#invalidate);
		if (this.#callback !== null) this.source.cancelVideoFrameCallback?.(this.#callback);
		this.#callback = null;
	}

	#invalidate = (): void => {
		if (this.#disposed) return;
		this.#revision += 1;
		this.#mediaTime = null;
		this.#presentedFrames = null;
	};

	#requestFrame(): void {
		if (!this.#usesCallbacks || this.#disposed) return;
		try {
			this.#callback = this.source.requestVideoFrameCallback!(this.#onFrame);
		} catch {
			// A partially available implementation can still display correctly by
			// taking the conservative playing-frame upload path.
			this.#usesCallbacks = false;
		}
	}

	#onFrame = (_now: number, metadata: FrameMetadata): void => {
		if (this.#disposed) return;
		this.#callback = null;
		if (metadata.mediaTime !== this.#mediaTime || metadata.presentedFrames !== this.#presentedFrames) {
			this.#mediaTime = metadata.mediaTime;
			this.#presentedFrames = metadata.presentedFrames;
			this.#revision += 1;
		}
		this.#requestFrame();
	};
}
