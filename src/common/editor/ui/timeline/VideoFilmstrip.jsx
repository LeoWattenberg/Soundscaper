import { useEffect, useMemo, useState } from 'react';
import { CLIP_CONTENT_OFFSET } from '@dilsonspickles/components';

import { framesToSeconds } from '../../design-system-adapters.js';
import { selectVideoThumbnailTimestamps } from '../../video-timeline.js';
import { createVideoRateBadgeModel } from './video-rate-badge-model.ts';

export function VideoFilmstripClip({
	controller,
	clip,
	source,
	overscanStartFrame,
	overscanEndFrame,
	pixelsPerSecond,
	sampleRate,
	selected,
	dragging,
	invalidOverlap,
	hidden,
	blocked,
	copy,
	onOpenMenu,
}) {
	const clipEndFrame = clip.timelineStartFrame + clip.durationFrames;
	const visibleStartFrame = Math.max(clip.timelineStartFrame, overscanStartFrame);
	const visibleEndFrame = Math.min(clipEndFrame, overscanEndFrame);
	const left = CLIP_CONTENT_OFFSET
		+ framesToSeconds(visibleStartFrame - overscanStartFrame, { sampleRate }) * pixelsPerSecond;
	const width = Math.max(2, framesToSeconds(visibleEndFrame - visibleStartFrame, { sampleRate }) * pixelsPerSecond);
	const clippedAtStart = visibleStartFrame !== clip.timelineStartFrame;
	const clippedAtEnd = visibleEndFrame !== clipEndFrame;
	const rateBadge = createVideoRateBadgeModel({
		clip,
		source,
		projectSampleRate: sampleRate,
	});
	const visualData = useVideoClipVisualData(controller, clip);
	const thumbnailPoints = useMemo(() => {
		if (!source || visibleEndFrame <= visibleStartFrame) return [];
		try {
			return selectVideoThumbnailTimestamps(clip, source, {
				projectSampleRate: sampleRate,
				visibleStartFrame,
				visibleEndFrame,
				pixelsPerSecond,
				baseIntervalSeconds: 5,
				minimumSpacingPixels: 72,
			});
		} catch {
			return [];
		}
	}, [
		clip,
		pixelsPerSecond,
		sampleRate,
		source,
		visibleEndFrame,
		visibleStartFrame,
	]);
	const fallbackPosterUrl = videoPosterUrl(visualData, source);
	return (
		<div
			className="audio-editor-video-clip"
			data-clip-id={clip.id}
			data-clip-kind="video"
			data-rate-stretch-preview={clip.rateStretchPreview ? 'true' : undefined}
			data-slip-slide-source-preview={clip.sourceSlipPreview ? 'true' : undefined}
			data-slip-slide-preview-source-start={clip.sourceSlipPreview
				? clip.sourceStartFrame
				: undefined}
			data-slip-slide-preview-source-end={clip.sourceSlipPreview
				? clip.sourceStartFrame + clip.sourceDurationFrames
				: undefined}
			data-dragging={dragging ? 'true' : 'false'}
			data-project-bin-preview={clip.projectBinClipId ? 'true' : undefined}
			data-invalid-overlap={invalidOverlap ? 'true' : undefined}
			role="group"
			tabIndex={-1}
			aria-label={`${copy.videoClip || 'Video clip'}: ${clip.title}`}
			style={{ left, width }}
			onContextMenu={(event) => {
				event.preventDefault();
				event.stopPropagation();
				onOpenMenu(clip.id, event.clientX, event.clientY);
			}}
		>
			<div
				className={`clip-display audio-editor-video-clip__display${selected ? ' clip-display--selected' : ''}`}
				data-hidden={hidden ? 'true' : 'false'}
				data-unavailable={visualData?.available === false ? 'true' : 'false'}
			>
				{!clippedAtStart && <>
					<span
						className="clip-display__handle clip-display__handle--trim-left audio-editor-video-clip__trim-handle"
						aria-hidden="true"
					/>
					<span
						className="clip-display__handle clip-display__handle--stretch-left audio-editor-video-clip__stretch-handle"
						aria-hidden="true"
					/>
				</>}
				{!clippedAtEnd && <>
					<span
						className="clip-display__handle clip-display__handle--trim-right audio-editor-video-clip__trim-handle"
						aria-hidden="true"
					/>
					<span
						className="clip-display__handle clip-display__handle--stretch-right audio-editor-video-clip__stretch-handle"
						aria-hidden="true"
					/>
				</>}
				<div className="clip-header audio-editor-video-clip__header">
					<span className="audio-editor-video-clip__title" title={clip.title}>{clip.title}</span>
					{rateBadge && (
						<span
							className="audio-editor-video-clip__speed"
							data-video-rate-badge="true"
							data-video-playback-rate={rateBadge.playbackRate}
							aria-label={rateBadge.label}
						>
							{rateBadge.label}
						</span>
					)}
				</div>
				<div className="audio-editor-video-clip__filmstrip" aria-hidden="true">
					{thumbnailPoints.length ? thumbnailPoints.map((point, index) => {
						const nextTimelineFrame = thumbnailPoints[index + 1]?.timelineFrame ?? visibleEndFrame;
						const cellLeft = framesToSeconds(point.timelineFrame - visibleStartFrame, { sampleRate }) * pixelsPerSecond;
						const cellWidth = Math.max(
							1,
							framesToSeconds(nextTimelineFrame - point.timelineFrame, { sampleRate }) * pixelsPerSecond,
						);
						const thumbnailUrl = videoThumbnailUrl(visualData, point, index) || fallbackPosterUrl;
						return (
							<span
								key={`${point.sourceFrame}-${index}`}
								className="audio-editor-video-clip__thumbnail"
								style={{ left: cellLeft, width: cellWidth }}
								title={`${point.sourceTimeSeconds.toFixed(1)} s`}
							>
								{thumbnailUrl && <img src={thumbnailUrl} alt="" draggable="false" />}
								{!thumbnailUrl && <span className="audio-editor-video-clip__thumbnail-time">
									{formatThumbnailTime(point.sourceTimeSeconds)}
								</span>}
							</span>
						);
					}) : (
						<span className="audio-editor-video-clip__thumbnail audio-editor-video-clip__thumbnail--fallback">
							{fallbackPosterUrl
								? <img src={fallbackPosterUrl} alt="" draggable="false" />
								: <span className="audio-editor-video-clip__thumbnail-time">{copy.videoClip || 'Video'}</span>}
						</span>
					)}
				</div>
				{blocked && <span className="audio-editor-video-clip__blocked" aria-hidden="true" />}
			</div>
		</div>
	);
}

export function useVideoClipVisualData(controller, clip) {
	const clipVisualRevision = [
		clip.durationFrames,
		clip.sourceDurationFrames,
		clip.sourceId,
		clip.sourceStartFrame,
	].join(':');
	const request = useMemo(() => {
		void clipVisualRevision;
		const getter = controller.actions.video?.getClipVisualData
			|| controller.actions.timeline?.getClipVisualData;
		if (!getter) return null;
		try {
			return getter(clip.id);
		} catch {
			return null;
		}
	}, [
		clip.id,
		clipVisualRevision,
		controller,
	]);
	const [asyncVisualData, setAsyncVisualData] = useState(null);
	const pending = Boolean(request && typeof request.then === 'function');
	useEffect(() => {
		let active = true;
		if (!pending) {
			setAsyncVisualData(null);
			return () => {
				active = false;
			};
		}
		setAsyncVisualData(null);
		Promise.resolve(request).then(
			(value) => {
				if (active) setAsyncVisualData(value || null);
			},
			() => {
				if (active) setAsyncVisualData(null);
			},
		);
		return () => {
			active = false;
		};
	}, [pending, request]);
	return pending ? asyncVisualData : request;
}

export function videoPosterUrl(visualData, source) {
	return firstUsableUrl(
		visualData?.posterUrl,
		visualData?.poster?.url,
		visualData?.poster?.objectUrl,
		visualData?.thumbnailUrl,
		source?.posterUrl,
		source?.thumbnailUrl,
	);
}

export function videoThumbnailUrl(visualData, point, index) {
	const direct = visualData?.thumbnailUrlAt?.(point.sourceTimeSeconds);
	if (typeof direct === 'string' && direct) return direct;
	const candidates = visualData?.thumbnails ?? visualData?.thumbnailUrls ?? visualData?.frames;
	if (candidates instanceof Map) {
		return firstUsableUrl(
			candidates.get(point.sourceTimeSeconds),
			candidates.get(point.sourceFrame),
			candidates.get(String(point.sourceTimeSeconds)),
			candidates.get(String(point.sourceFrame)),
		);
	}
	if (Array.isArray(candidates)) {
		if (typeof candidates[index] === 'string') return candidates[index];
		const matching = candidates.find((candidate) => {
			const timestamp = Number(candidate?.sourceTimeSeconds ?? candidate?.timestamp ?? candidate?.time);
			return Number.isFinite(timestamp) && Math.abs(timestamp - point.sourceTimeSeconds) < 0.05;
		});
		const indexed = candidates[point.gridIndex] || candidates[index];
		return firstUsableUrl(
			matching?.url,
			matching?.objectUrl,
			matching?.src,
			indexed?.url,
			indexed?.objectUrl,
			indexed?.src,
		);
	}
	if (candidates && typeof candidates === 'object') {
		const keyed = candidates[point.sourceTimeSeconds]
			?? candidates[point.sourceFrame]
			?? candidates[String(point.sourceTimeSeconds)]
			?? candidates[String(point.sourceFrame)];
		return firstUsableUrl(keyed?.url, keyed?.objectUrl, keyed?.src, keyed);
	}
	return null;
}

export function firstUsableUrl(...values) {
	for (const value of values) {
		if (typeof value === 'string' && value) return value;
	}
	return null;
}

export function formatThumbnailTime(seconds) {
	const value = Math.max(0, Number(seconds) || 0);
	const minutes = Math.floor(value / 60);
	const remaining = Math.floor(value % 60);
	return `${minutes}:${String(remaining).padStart(2, '0')}`;
}
