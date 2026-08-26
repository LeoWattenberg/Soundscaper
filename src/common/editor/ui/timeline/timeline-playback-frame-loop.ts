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
