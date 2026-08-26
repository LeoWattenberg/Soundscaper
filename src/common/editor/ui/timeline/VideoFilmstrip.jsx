import { useEffect, useMemo, useRef, useState } from 'react';
import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';

import { framesToSeconds } from '../../design-system-adapters.js';
import { selectVideoThumbnailTimestamps } from '../../video-timeline.js';
import { productVideoVisualPreviewRuntimeFor } from '../workspace/product-video-visual-preview-runtime.ts';
import { selectProductVisualThumbnailPoints } from './product-visual-thumbnail-points.ts';
import { createVideoRateBadgeModel } from './video-rate-badge-model.ts';

export function VideoFilmstripClip({
	controller,
	project,
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
	onRename,
	renameRequestId,
	onRenameFinished,
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
			if (clip.kind === 'image') return selectProductVisualThumbnailPoints({
				clip,
				visibleStartFrame,
				visibleEndFrame,
				projectSampleRate: sampleRate,
				pixelsPerSecond,
				baseIntervalSeconds: 5,
				minimumSpacingPixels: 72,
			});
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
	const thumbnailModels = useMemo(() => thumbnailPoints.map((point, index) => ({
		key: `${point.timelineFrame}:${point.sourceFrame}:${index}`,
		point,
		sourceUrl: clip.kind === 'image'
			? `product-image:${String(clip.sourceId)}`
			: videoThumbnailUrl(visualData, point, index),
	})), [clip.kind, clip.sourceId, thumbnailPoints, visualData]);
	const presentationThumbnails = useProductTimelineFilmstrip({
		controller, project, clip, thumbnailModels,
	});
	const [isRenaming, setIsRenaming] = useState(false);
	const [renameDraft, setRenameDraft] = useState(clip.title);
	const renameInputRef = useRef(null);
	const consumedRenameRequestRef = useRef(undefined);

	useEffect(() => {
		if (!isRenaming) setRenameDraft(clip.title);
	}, [clip.title, isRenaming]);
	useEffect(() => {
		if (!isRenaming) return undefined;
		const frame = requestAnimationFrame(() => {
			renameInputRef.current?.focus();
			renameInputRef.current?.select();
		});
		return () => cancelAnimationFrame(frame);
	}, [isRenaming]);
	useEffect(() => {
		if (renameRequestId === undefined || renameRequestId === consumedRenameRequestRef.current) return;
		consumedRenameRequestRef.current = renameRequestId;
		if (blocked || !onRename) {
			onRenameFinished?.();
			return;
		}
		setRenameDraft(clip.title);
		setIsRenaming(true);
	}, [blocked, clip.title, onRename, onRenameFinished, renameRequestId]);
	const finishRename = (commit) => {
		const title = renameDraft.trim();
		if (commit && title && title !== clip.title) onRename(title);
		setIsRenaming(false);
		onRenameFinished?.();
	};
	return (
		<div
			className="audio-editor-video-clip"
			data-clip-id={clip.id}
			data-clip-kind={clip.kind === 'image' ? 'image' : 'video'}
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
			aria-label={`${clip.kind === 'image' ? 'Image clip' : copy.videoClip || 'Video clip'}: ${clip.title}`}
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
					{isRenaming ? (
						<input
							ref={renameInputRef}
							className="audio-editor-video-clip__title-input"
							value={renameDraft}
							onChange={(event) => setRenameDraft(event.target.value)}
							onKeyDown={(event) => {
								event.stopPropagation();
								if (event.key === 'Enter') {
									event.preventDefault();
									finishRename(true);
								} else if (event.key === 'Escape') {
									event.preventDefault();
									finishRename(false);
								}
							}}
							onBlur={() => finishRename(true)}
							onClick={(event) => event.stopPropagation()}
							onMouseDown={(event) => event.stopPropagation()}
							aria-label={copy.clipName}
						/>
					) : (
						<span
							className="audio-editor-video-clip__title"
							title={clip.title}
							onMouseDown={(event) => {
								if (event.detail !== 2 || blocked || !onRename) return;
								event.preventDefault();
								event.stopPropagation();
								setRenameDraft(clip.title);
								setIsRenaming(true);
							}}
							onDoubleClick={(event) => {
								event.stopPropagation();
								if (blocked || !onRename) return;
								setRenameDraft(clip.title);
								setIsRenaming(true);
							}}
						>{clip.title}</span>
					)}
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
					{thumbnailModels.length ? thumbnailModels.map((model, index) => {
						const { point } = model;
						const nextTimelineFrame = thumbnailPoints[index + 1]?.timelineFrame ?? visibleEndFrame;
						const cellLeft = framesToSeconds(point.timelineFrame - visibleStartFrame, { sampleRate }) * pixelsPerSecond;
						const cellWidth = Math.max(
							1,
							framesToSeconds(nextTimelineFrame - point.timelineFrame, { sampleRate }) * pixelsPerSecond,
						);
						const thumbnailUrl = model.sourceUrl || fallbackPosterUrl;
						const exact = presentationThumbnails.values.get(model.key) || null;
						return (
							<span
								key={model.key}
								className="audio-editor-video-clip__thumbnail"
								data-product-visual-thumbnail={presentationThumbnails.supported ? 'true' : undefined}
								data-product-visual-thumbnail-state={presentationThumbnails.supported
									? exact ? 'ready' : presentationThumbnails.error ? 'error' : 'pending'
									: undefined}
								style={{ left: cellLeft, width: cellWidth }}
								title={`${point.sourceTimeSeconds.toFixed(1)} s`}
							>
								{exact && <ProductTimelineFilmstripCanvas value={exact} />}
								{!presentationThumbnails.supported && thumbnailUrl
									&& <img src={thumbnailUrl} alt="" draggable="false" />}
								{!exact && (presentationThumbnails.supported || !thumbnailUrl)
									&& <span className="audio-editor-video-clip__thumbnail-time">
									{formatThumbnailTime(point.sourceTimeSeconds)}
								</span>}
							</span>
						);
					}) : (
						<span className="audio-editor-video-clip__thumbnail audio-editor-video-clip__thumbnail--fallback">
							{!presentationThumbnails.supported && fallbackPosterUrl
								? <img src={fallbackPosterUrl} alt="" draggable="false" />
									: <span className="audio-editor-video-clip__thumbnail-time">{
										clip.kind === 'image' ? 'Image' : copy.videoClip || 'Video'
									}</span>}
						</span>
					)}
				</div>
				{blocked && <span className="audio-editor-video-clip__blocked" aria-hidden="true" />}
			</div>
		</div>
	);
}

function useProductTimelineFilmstrip({ controller, project, clip, thumbnailModels }) {
	const runtime = useMemo(() => productVideoVisualPreviewRuntimeFor(controller), [controller]);
	const createTimelineFilmstrip = runtime?.createTimelineFilmstrip;
	const supported = Boolean(
		project && !clip.projectBinClipId && typeof createTimelineFilmstrip === 'function',
	);
	const frames = useMemo(() => supported ? thumbnailModels.flatMap((model) => (
		model.sourceUrl ? [{
			key: model.key,
			clipId: clip.id,
			sourceId: clip.sourceId,
			timelineSample: model.point.timelineFrame,
			sourceUrl: model.sourceUrl,
		}] : []
	)) : [], [clip.id, clip.sourceId, supported, thumbnailModels]);
	const [state, setState] = useState(() => ({ pending: false, error: null, values: new Map() }));
	useEffect(() => {
		if (!supported || frames.length === 0) {
			setState({ pending: false, error: null, values: new Map() });
			return undefined;
		}
		const abort = new AbortController();
		setState({ pending: true, error: null, values: new Map() });
		void createTimelineFilmstrip({
			project, width: 160, height: 90, frames, signal: abort.signal,
		}).then((values) => {
			if (abort.signal.aborted) return;
			if (!values || values.length !== frames.length) {
				throw new Error('The exact timeline filmstrip did not publish every requested frame.');
			}
			setState({
				pending: false,
				error: null,
				values: new Map(values.map((value) => [value.key, value])),
			});
		}).catch((cause) => {
			if (!abort.signal.aborted) setState({
				pending: false,
				error: cause instanceof Error ? cause.message : String(cause),
				values: new Map(),
			});
		});
		return () => { abort.abort(new DOMException('Timeline filmstrip was replaced.', 'AbortError')); };
	}, [createTimelineFilmstrip, frames, project, supported]);
	return { supported, ...state };
}

function ProductTimelineFilmstripCanvas({ value }) {
	const canvasRef = useRef(null);
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		canvas.width = value.width;
		canvas.height = value.height;
		const context = canvas.getContext('2d');
		if (!context) return;
		context.putImageData(
			new ImageData(new Uint8ClampedArray(value.pixels), value.width, value.height),
			0,
			0,
		);
	}, [value]);
	return <canvas ref={canvasRef} data-product-visual-thumbnail-canvas aria-hidden="true" />;
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
