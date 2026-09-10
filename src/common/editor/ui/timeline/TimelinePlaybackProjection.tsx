/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';

import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import {
	createTimelinePlaybackFrameLoop,
	lowRateTimelinePositionFrame,
	resolveTimelinePlaybackScroll,
	type TimelinePlaybackFollowMode,
} from './timeline-playback-frame-loop.ts';
import {
	readTimelineContentScrollX,
	timelineDomScrollForElement,
} from './timeline-scroll-space.ts';

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
	followMode,
}: Readonly<{
	controller: PlaybackProjectionController;
	rootRef: RefObject<HTMLElement | null>;
	scrollRef: RefObject<HTMLElement | null>;
	pixelsPerSecond: number;
	sampleRate: number;
	viewportWidth: number;
	followMode: TimelinePlaybackFollowMode;
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
	const suspendedRef = useRef(false);
	const automaticScrollRef = useRef<number | null>(null);
	latestPositionRef.current = positionFrame;
	const projectPosition = useCallback((rawFrame: number, follow: boolean) => {
		const frame = Math.max(0, Number(rawFrame) || 0);
		const playheadX = CLIP_CONTENT_OFFSET
			+ frame / Math.max(1, sampleRate) * pixelsPerSecond;
		rootRef.current?.style.setProperty(
			'--timeline-playhead-x',
			`${playheadX}px`,
		);
		const scroll = scrollRef.current;
		if (!follow || !scroll) return;
		const resolution = resolveTimelinePlaybackScroll({
			mode: followMode,
			playheadX,
			scrollX: readTimelineContentScrollX(scroll),
			viewportWidth,
			leadingInset: CLIP_CONTENT_OFFSET,
			suspended: suspendedRef.current,
		});
		suspendedRef.current = resolution.suspended;
		if (resolution.targetScrollX === null) return;
		const nextScroll = timelineDomScrollForElement(
			scroll,
			resolution.targetScrollX,
		);
		if (Math.abs(scroll.scrollLeft - nextScroll) <= 1) return;
		automaticScrollRef.current = nextScroll;
		scroll.scrollLeft = nextScroll;
	}, [followMode, pixelsPerSecond, rootRef, sampleRate, scrollRef, viewportWidth]);

	useEffect(() => {
		suspendedRef.current = false;
	}, [followMode]);

	useEffect(() => {
		const scroll = scrollRef.current;
		if (!scroll) return undefined;
		let previousScrollLeft = scroll.scrollLeft;
		const handleScroll = () => {
			const currentScrollLeft = scroll.scrollLeft;
			if (Math.abs(previousScrollLeft - currentScrollLeft) <= 1) return;
			previousScrollLeft = currentScrollLeft;
			const automaticScroll = automaticScrollRef.current;
			if (automaticScroll !== null && Math.abs(automaticScroll - currentScrollLeft) <= 1) {
				automaticScrollRef.current = null;
				return;
			}
			automaticScrollRef.current = null;
			const frame = controller.engine?.getPositionFrames?.() ?? latestPositionRef.current;
			const playheadX = CLIP_CONTENT_OFFSET
				+ Math.max(0, Number(frame) || 0) / Math.max(1, sampleRate) * pixelsPerSecond;
			suspendedRef.current = resolveTimelinePlaybackScroll({
				mode: followMode,
				playheadX,
				scrollX: readTimelineContentScrollX(scroll),
				viewportWidth,
				leadingInset: CLIP_CONTENT_OFFSET,
				suspended: true,
			}).suspended;
		};
		scroll.addEventListener('scroll', handleScroll);
		return () => scroll.removeEventListener('scroll', handleScroll);
	}, [controller, followMode, pixelsPerSecond, sampleRate, scrollRef, viewportWidth]);

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
