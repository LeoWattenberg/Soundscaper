/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef } from 'react';

import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import { findVideoPreviewTimelineInterval } from './video-preview-compositor-pool.js';

export function selectVideoPreviewPosition({
	telemetry,
	selection,
	intervals,
	compositorState,
	sampleRate,
}) {
	const nextFrame = Math.max(0, Number(telemetry.positionFrame) || 0);
	const nextInterval = findVideoPreviewTimelineInterval(intervals, nextFrame);
	const gpuPlaying = telemetry.transportState === 'playing'
		&& compositorState !== 'pending'
		&& compositorState !== 'fallback';
	const actualAdvance = nextFrame - selection.observedFrame;
	// Telemetry normally arrives every 50 ms. Allow a generous delayed sample
	// before treating a forward jump as an explicit transport seek.
	const maximumExpectedAdvance = sampleRate * (
		Math.max(0.001, Number(telemetry.playbackRate) || 1) * 0.2 + 0.1
	);
	const discontinuity = actualAdvance < 0
		|| actualAdvance > maximumExpectedAdvance;
	const shouldPublish = !gpuPlaying
		|| !selection.gpuPlaying
		|| nextInterval !== selection.interval
		|| discontinuity;
	selection.gpuPlaying = gpuPlaying;
	selection.interval = nextInterval;
	selection.observedFrame = nextFrame;
	if (shouldPublish && (
		selection.published.frame !== nextFrame
			|| gpuPlaying
	)) selection.published = { frame: nextFrame };
	return selection.published;
}

export function useVideoPreviewTransportState({
	controller,
	compositorTimelineRef,
	compositorStateRef,
}) {
	const selectionRef = useRef({
		gpuPlaying: false,
		interval: null,
		observedFrame: 0,
		published: { frame: 0 },
	});
	const positionSelection = useAudioEditorTelemetrySelector(
		controller,
		(telemetry) => selectVideoPreviewPosition({
			telemetry,
			selection: selectionRef.current,
			intervals: compositorTimelineRef.current.intervals,
			compositorState: compositorStateRef.current,
			sampleRate: Math.max(1, Number(controller.engine?.sampleRate) || 48_000),
		}),
	);
	const transportState = useAudioEditorTelemetrySelector(
		controller,
		(telemetry) => telemetry.transportState || 'stopped',
	);
	const playbackRate = useAudioEditorTelemetrySelector(
		controller,
		(telemetry) => Math.max(0.001, Number(telemetry.playbackRate) || 1),
	);
	return {
		positionFrame: positionSelection.frame,
		transportState,
		playbackRate,
	};
}
