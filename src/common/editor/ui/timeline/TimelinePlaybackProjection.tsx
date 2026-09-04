/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';

import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import {
	createTimelinePlaybackFrameLoop,
	lowRateTimelinePositionFrame,
} from './timeline-playback-frame-loop.ts';
import { timelineDomScrollForElement } from './timeline-scroll-space.ts';

interface PlaybackTelemetrySnapshot {
	readonly positionFrame?: number;
	readonly transportState?: string;
}

interface PlaybackProjectionController {
	readonly engine?: Readonly<{ getPositionFrames?: () => number }>;
	readonly getTelemetrySnapshot: () => PlaybackTelemetrySnapshot;
	readonly subscribeTelemetry: (listener: () => void) => () => void;
}

export function TimelinePlaybackProjection({
	controller,
	rootRef,
	scrollRef,
	pixelsPerSecond,
	sampleRate,
	viewportWidth,
	pinned,
}: Readonly<{
	controller: PlaybackProjectionController;
	rootRef: RefObject<HTMLElement | null>;
	scrollRef: RefObject<HTMLElement | null>;
	pixelsPerSecond: number;
	sampleRate: number;
	viewportWidth: number;
	pinned: boolean;
}>) {
	const positionFrame = useAudioEditorTelemetrySelector(
		controller,
		(telemetry: PlaybackTelemetrySnapshot) => lowRateTimelinePositionFrame(telemetry, sampleRate),
	);
	const transportState = useAudioEditorTelemetrySelector(
		controller,
		(telemetry: PlaybackTelemetrySnapshot) => telemetry.transportState || 'stopped',
	);
	const latestPositionRef = useRef(positionFrame);
	latestPositionRef.current = positionFrame;
	const projectPosition = useCallback((rawFrame: number, follow: boolean) => {
		const frame = Math.max(0, Number(rawFrame) || 0);
		const positionPixels = frame / Math.max(1, sampleRate) * pixelsPerSecond;
		rootRef.current?.style.setProperty(
			'--timeline-playhead-x',
			`${CLIP_CONTENT_OFFSET + positionPixels}px`,
		);
		const scroll = scrollRef.current;
		if (!follow || !pinned || !scroll) return;
		const nextScroll = timelineDomScrollForElement(
			scroll,
			CLIP_CONTENT_OFFSET + positionPixels - viewportWidth / 2,
		);
		if (Math.abs(scroll.scrollLeft - nextScroll) > 1) scroll.scrollLeft = nextScroll;
	}, [pinned, pixelsPerSecond, rootRef, sampleRate, scrollRef, viewportWidth]);

	useLayoutEffect(() => {
		if (transportState === 'playing' || transportState === 'recording') return;
		projectPosition(positionFrame, false);
	}, [positionFrame, projectPosition, transportState]);

	useEffect(() => {
		if (transportState !== 'playing' && transportState !== 'recording') return undefined;
		const loop = createTimelinePlaybackFrameLoop({
			requestFrame: (callback) => globalThis.requestAnimationFrame(callback),
			cancelFrame: (frame) => globalThis.cancelAnimationFrame(frame),
			readPosition: () => controller.engine?.getPositionFrames?.() ?? latestPositionRef.current,
			renderPosition: (frame) => projectPosition(frame, true),
		});
		loop.start();
		return () => loop.dispose();
	}, [controller, projectPosition, transportState]);

	return null;
}
