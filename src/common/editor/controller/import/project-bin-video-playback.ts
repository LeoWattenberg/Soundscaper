/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ProjectBinRetimeMedia {
	currentTime: number;
	readonly seeking: boolean;
	pause(): void;
	addEventListener(type: 'loadedmetadata' | 'seeked', listener: () => void): void;
	removeEventListener(type: 'loadedmetadata' | 'seeked', listener: () => void): void;
}

export interface ProjectBinRetimePlaybackDependencies {
	readonly media: ProjectBinRetimeMedia;
	readonly sampleRate: number;
	readonly durationFrames: number;
	sourceTimeAtFrame(frame: number): number;
	now(): number;
	requestFrame(callback: () => void): number;
	cancelFrame(id: number): void;
	onComplete(): void;
}

/** Own the bin occurrence's clock while exact retime pictures keep native media paused. */
export function createProjectBinRetimePlayback(dependencies: ProjectBinRetimePlaybackDependencies) {
	const { media, sampleRate, durationFrames } = dependencies;
	if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0
		|| !Number.isSafeInteger(durationFrames) || durationFrames <= 0) {
		throw new RangeError('Retimed bin playback requires a positive sample clock and duration.');
	}
	let elapsedFrames = 0;
	let playing = false;
	let startedAt = 0;
	let frameId: number | null = null;
	let disposed = false;
	const currentFrame = () => Math.min(durationFrames, elapsedFrames + (playing
		? Math.max(0, dependencies.now() - startedAt) * sampleRate / 1_000 : 0));
	const synchronize = () => {
		if (disposed) return;
		media.pause();
		const time = dependencies.sourceTimeAtFrame(Math.min(durationFrames - 1, Math.floor(currentFrame())));
		if (!media.seeking && Math.abs(media.currentTime - time) > 0.000001) {
			try { media.currentTime = time; }
			catch { /* Metadata readiness retries the same owned picture. */ }
		}
	};
	function cancelFrame(): void {
		if (frameId !== null) dependencies.cancelFrame(frameId);
		frameId = null;
	}
	function tick(): void {
		frameId = null;
		if (disposed || !playing) return;
		if (currentFrame() >= durationFrames) {
			playing = false;
			elapsedFrames = 0;
			media.pause();
			try { media.currentTime = dependencies.sourceTimeAtFrame(0); }
			catch { /* The settled owner retries if metadata arrives after completion. */ }
			dependencies.onComplete();
			return;
		}
		synchronize();
		frameId = dependencies.requestFrame(tick);
	}
	media.addEventListener('loadedmetadata', synchronize);
	media.addEventListener('seeked', synchronize);
	synchronize();
	return Object.freeze({
		play(): void {
			if (disposed || playing) return;
			playing = true;
			startedAt = dependencies.now();
			synchronize();
			frameId = dependencies.requestFrame(tick);
		},
		pause(): void {
			if (disposed) return;
			elapsedFrames = currentFrame();
			playing = false;
			cancelFrame();
			synchronize();
		},
		dispose(): void {
			if (disposed) return;
			disposed = true;
			playing = false;
			cancelFrame();
			media.pause();
			media.removeEventListener('loadedmetadata', synchronize);
			media.removeEventListener('seeked', synchronize);
		},
	});
}
