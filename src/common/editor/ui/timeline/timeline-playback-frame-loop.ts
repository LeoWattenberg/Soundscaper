/* SPDX-License-Identifier: AGPL-3.0-only */

interface TimelinePlaybackFrameLoopOptions {
	readonly requestFrame: (callback: FrameRequestCallback) => number;
	readonly cancelFrame: (frame: number) => void;
	readonly readPosition: () => number;
	readonly renderPosition: (positionFrame: number) => void;
}

interface TimelinePositionTelemetry {
	readonly positionFrame?: unknown;
	readonly transportState?: unknown;
}

export type TimelinePlaybackFollowMode = 'none' | 'page' | 'pinned';

interface TimelinePlaybackScrollOptions {
	readonly mode: TimelinePlaybackFollowMode;
	readonly playheadX: number;
	readonly scrollX: number;
	readonly viewportWidth: number;
	readonly leadingInset: number;
	readonly suspended?: boolean;
}

export interface TimelinePlaybackScrollResolution {
	readonly suspended: boolean;
	readonly targetScrollX: number | null;
}

const ACCESSIBLE_POSITION_UPDATES_PER_SECOND = 4;

export function lowRateTimelinePositionFrame(
	telemetry: TimelinePositionTelemetry,
	sampleRate: number,
): number {
	const positionFrame = Math.max(0, Math.round(Number(telemetry.positionFrame) || 0));
	if (telemetry.transportState !== 'playing' && telemetry.transportState !== 'recording') {
		return positionFrame;
	}
	const intervalFrames = Math.max(1, Math.round(
		(Number(sampleRate) || 48_000) / ACCESSIBLE_POSITION_UPDATES_PER_SECOND,
	));
	return Math.floor(positionFrame / intervalFrames) * intervalFrames;
}

export function resolveTimelinePlaybackScroll({
	mode,
	playheadX,
	scrollX,
	viewportWidth,
	leadingInset,
	suspended = false,
}: TimelinePlaybackScrollOptions): TimelinePlaybackScrollResolution {
	const position = Math.max(0, Number(playheadX) || 0);
	const viewportStart = Math.max(0, Number(scrollX) || 0);
	const viewport = Math.max(1, Number(viewportWidth) || 1);
	const inset = Math.max(0, Number(leadingInset) || 0);
	const visible = position >= viewportStart + inset && position <= viewportStart + viewport;
	if (mode === 'none') return { suspended: false, targetScrollX: null };
	if (suspended && !visible) return { suspended: true, targetScrollX: null };
	if (mode === 'pinned') {
		return { suspended: false, targetScrollX: Math.max(0, position - viewport / 2) };
	}
	return {
		suspended: false,
		targetScrollX: position >= viewportStart + viewport
			? Math.max(0, position - inset)
			: null,
	};
}

export interface TimelinePlaybackFrameLoop {
	dispose(): void;
	start(): void;
	stop(): void;
}

export function createTimelinePlaybackFrameLoop({
	requestFrame,
	cancelFrame,
	readPosition,
	renderPosition,
}: TimelinePlaybackFrameLoopOptions): TimelinePlaybackFrameLoop {
	let frame: number | null = null;
	let running = false;
	let disposed = false;
	const draw: FrameRequestCallback = () => {
		frame = null;
		if (!running || disposed) return;
		renderPosition(readPosition());
		frame = requestFrame(draw);
	};
	const stop = () => {
		running = false;
		if (frame === null) return;
		cancelFrame(frame);
		frame = null;
	};
	return {
		dispose() {
			disposed = true;
			stop();
		},
		start() {
			if (disposed || running) return;
			running = true;
			frame = requestFrame(draw);
		},
		stop,
	};
}
