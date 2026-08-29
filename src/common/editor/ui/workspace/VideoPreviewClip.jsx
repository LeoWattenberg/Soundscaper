/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useMemo, useRef } from 'react';

import { createVideoPreviewPresentedFrameGate } from '../../controller/video-preview-presented-frame.ts';
import { synchronizeVideoPreviewMedia } from './video-preview-retime.ts';

export default function VideoPreviewClip({
	entry,
	transportState,
	transportPlaybackRate,
	copy,
	onVideoElement,
	onFrameReady,
	onMediaError,
	hideIdentityFallback,
}) {
	const videoRef = useRef(null);
	const onFrameReadyRef = useRef(onFrameReady);
	const presentedFrameGateRef = useRef(null);
	if (!presentedFrameGateRef.current) {
		presentedFrameGateRef.current = createVideoPreviewPresentedFrameGate();
	}
	onFrameReadyRef.current = onFrameReady;
	const cancelPresentedFrameCallback = useCallback(() => {
		presentedFrameGateRef.current.cancel();
	}, []);
	const setVideoRef = useCallback((element) => {
		if (videoRef.current !== element) cancelPresentedFrameCallback();
		videoRef.current = element;
		onVideoElement?.(entry.clipId, element);
	}, [cancelPresentedFrameCallback, entry.clipId, onVideoElement]);
	const syncVideo = useCallback(() => {
		const video = videoRef.current;
		if (!video) return;
		synchronizeVideoPreviewMedia(video, entry, transportPlaybackRate, transportState);
	}, [entry, transportPlaybackRate, transportState]);
	const presentedFrameKey = useMemo(() => Object.freeze({
		sourceUrl: entry.sourceUrl,
		sourceTimeSeconds: Math.max(0, Number(entry.sourceTimeSeconds) || 0),
	}), [entry.sourceTimeSeconds, entry.sourceUrl]);
	const requestFrameWhenPresented = useCallback(() => {
		const video = videoRef.current;
		if (!video) return;
		presentedFrameGateRef.current.request(
			video, presentedFrameKey, () => onFrameReadyRef.current?.(),
		);
	}, [presentedFrameKey]);
	const handleMediaReady = useCallback(() => {
		requestFrameWhenPresented();
		syncVideo();
	}, [requestFrameWhenPresented, syncVideo]);
	const handleMediaError = useCallback(() => {
		const video = videoRef.current;
		video?.pause?.();
		onMediaError?.(entry.clipId, entry.sourceId, entry.sourceUrl, video);
	}, [entry.clipId, entry.sourceId, entry.sourceUrl, onMediaError]);

	useEffect(() => {
		requestFrameWhenPresented();
		syncVideo();
	}, [requestFrameWhenPresented, syncVideo]);
	useEffect(() => () => {
		cancelPresentedFrameCallback();
		videoRef.current?.pause?.();
	}, [cancelPresentedFrameCallback]);

	const opacity = Math.max(0, Math.min(1, Number(entry.opacity) || 0));
	return (
		<video
			ref={setVideoRef}
			className="kw-audio-editor__video-preview-clip"
			data-video-preview-clip
			data-clip-id={entry.clipId}
			data-transition-role={entry.role || 'single'}
			data-opacity={opacity}
			data-identity-fallback-hidden={hideIdentityFallback ? 'true' : 'false'}
			src={entry.sourceUrl}
			muted
			playsInline
			preload="auto"
			aria-label={`${copy.panelVideoPreview}: ${entry.clip?.title || entry.source?.name || copy.videoClip}`}
			aria-hidden={hideIdentityFallback || undefined}
			style={{
				opacity,
				mixBlendMode: entry.role === 'incoming' ? 'plus-lighter' : 'normal',
				visibility: hideIdentityFallback ? 'hidden' : undefined,
			}}
			onLoadedMetadata={handleMediaReady}
			onLoadedData={handleMediaReady}
			onCanPlay={handleMediaReady}
			onSeeked={requestFrameWhenPresented}
			onError={handleMediaError}
		/>
	);
}
