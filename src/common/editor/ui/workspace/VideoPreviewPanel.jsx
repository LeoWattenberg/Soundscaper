import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { resolveVideoExportCanvas } from '../../video-export.js';
import { resolveActiveVideoLayers, resolveVideoCompositionIntervals } from '../../video-timeline.js';
import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import { createVideoPreviewCompositor } from '../video-preview-compositor.js';
import { createVideoPreviewEffectBypass } from './video-preview-effect-bypass.ts';

const EMPTY_VIDEO_EFFECT_STACK = Object.freeze([]);

function createVideoPreviewCompositorEntry() {
	return {
		clipId: null,
		video: null,
		effects: EMPTY_VIDEO_EFFECT_STACK,
		opacity: 0,
	};
}

function clearVideoPreviewCompositorEntry(entry) {
	entry.clipId = null;
	entry.video = null;
	entry.effects = EMPTY_VIDEO_EFFECT_STACK;
	entry.opacity = 0;
}

function clearVideoPreviewCompositorLayer(layer) {
	for (let entryIndex = 0; entryIndex < layer.entryPool.length; entryIndex += 1) {
		clearVideoPreviewCompositorEntry(layer.entryPool[entryIndex]);
	}
	layer.trackId = null;
	layer.entries.length = 0;
}

function primeVideoPreviewCompositorPool(layerPool, layerCount) {
	while (layerPool.length < layerCount) {
		layerPool.push({
			trackId: null,
			entries: [],
			entryPool: [
				createVideoPreviewCompositorEntry(),
				createVideoPreviewCompositorEntry(),
			],
		});
	}
}

function createVideoPreviewTimeline(project, controller, missingSourceIds, failedVideoSources) {
	if (!project) return { intervals: [], clipStateById: new Map(), maxLayerCount: 0 };
	try {
		const intervals = resolveVideoCompositionIntervals(project);
		const clipStateById = new Map();
		for (const clip of project.clips || []) {
			if (clip?.kind !== 'video') continue;
			const visual = controller.actions.video?.getClipVisualData?.(clip.id)
				|| controller.actions.timeline.getClipVisualData?.(clip.id);
			const sourceUrl = visual?.mediaUrl || visual?.url || null;
			clipStateById.set(clip.id, {
				available: Boolean(
					project.sources?.some((source) => source.id === clip.sourceId)
					&& sourceUrl
					&& visual?.available !== false
					&& !missingSourceIds.has(clip.sourceId)
					&& failedVideoSources.get(clip.id) !== sourceUrl,
				),
			});
		}
		let maxLayerCount = 0;
		for (const interval of intervals) {
			maxLayerCount = Math.max(maxLayerCount, interval.layers?.length || 0);
		}
		return { intervals, clipStateById, maxLayerCount };
	} catch {
		return { intervals: [], clipStateById: new Map(), maxLayerCount: 0 };
	}
}

function findVideoPreviewTimelineInterval(intervals, timelineFrame) {
	let startIndex = 0;
	let endIndex = intervals.length - 1;
	while (startIndex <= endIndex) {
		const index = (startIndex + endIndex) >> 1;
		const interval = intervals[index];
		if (timelineFrame < interval.timelineStartFrame) endIndex = index - 1;
		else if (timelineFrame >= interval.timelineEndFrame) startIndex = index + 1;
		else return interval;
	}
	return null;
}

function synchronizeVideoPreviewCompositorLayers(
	targetLayers,
	layerPool,
	timeline,
	timelineFrame,
	videoElements,
	videoEffectBypass,
) {
	const interval = findVideoPreviewTimelineInterval(timeline.intervals, timelineFrame);
	if (!interval || interval.kind !== 'composition') {
		for (let layerIndex = 0; layerIndex < layerPool.length; layerIndex += 1) {
			clearVideoPreviewCompositorLayer(layerPool[layerIndex]);
		}
		targetLayers.length = 0;
		return true;
	}
	for (let layerIndex = 0; layerIndex < interval.layers.length; layerIndex += 1) {
		const layer = interval.layers[layerIndex];
		for (let clipIndex = 0; clipIndex < layer.clips.length; clipIndex += 1) {
			const clip = layer.clips[clipIndex];
			if (!timeline.clipStateById.get(clip.clipId)?.available) continue;
			const video = videoElements.get(clip.clipId);
			if (
				targetLayers.length
				&& (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight)
			) return false;
		}
	}
	const intervalProgress = Math.max(0, Math.min(
		1,
		(timelineFrame - interval.timelineStartFrame)
			/ Math.max(1, interval.timelineEndFrame - interval.timelineStartFrame),
	));
	let targetLayerCount = 0;
	for (let layerIndex = 0; layerIndex < interval.layers.length; layerIndex += 1) {
		const layer = interval.layers[layerIndex];
		const targetLayer = layerPool[targetLayerCount];
		targetLayers[targetLayerCount] = targetLayer;
		targetLayer.trackId = layer.trackId;

		let targetEntryCount = 0;
		for (let clipIndex = 0; clipIndex < layer.clips.length; clipIndex += 1) {
			const clip = layer.clips[clipIndex];
			if (!timeline.clipStateById.get(clip.clipId)?.available) continue;
			const targetEntry = targetLayer.entryPool[targetEntryCount];
			targetLayer.entries[targetEntryCount] = targetEntry;
			targetEntry.clipId = clip.clipId;
			targetEntry.video = videoElements.get(clip.clipId) || null;
			targetEntry.effects = videoEffectBypass.effectsFor(
				clip.clipId,
				clip.clip?.videoEffects || EMPTY_VIDEO_EFFECT_STACK,
			);
			targetEntry.opacity = clip.opacityStart
				+ (clip.opacityEnd - clip.opacityStart) * intervalProgress;
			targetEntryCount += 1;
		}
		for (let entryIndex = targetEntryCount; entryIndex < targetLayer.entryPool.length; entryIndex += 1) {
			clearVideoPreviewCompositorEntry(targetLayer.entryPool[entryIndex]);
		}
		targetLayer.entries.length = targetEntryCount;
		targetLayerCount += 1;
	}
	for (let layerIndex = targetLayerCount; layerIndex < layerPool.length; layerIndex += 1) {
		clearVideoPreviewCompositorLayer(layerPool[layerIndex]);
	}
	targetLayers.length = targetLayerCount;
	return true;
}

function releaseRetiredVideoPreviewElements(compositor, retiredVideos) {
	while (retiredVideos.length) {
		compositor.releaseVideo(retiredVideos.pop());
	}
}

export default function VideoPreviewPanel({ controller, snapshot, copy }) {
	const canvasRef = useRef(null);
	const compositorRef = useRef(null);
	const videoElementsRef = useRef(new Map());
	const compositorLayersRef = useRef([]);
	const compositorLayerPoolRef = useRef([]);
	const compositorTimelineRef = useRef({ intervals: [], clipStateById: new Map(), maxLayerCount: 0 });
	const renderOptionsRef = useRef({ referenceWidth: 1_280, referenceHeight: 720 });
	const retiredVideoElementsRef = useRef([]);
	const failedVideoSourcesRef = useRef(new Map());
	const previewPositionSelectionRef = useRef({
		gpuPlaying: false,
		interval: null,
		observedFrame: 0,
		published: { frame: 0 },
	});
	const playheadRef = useRef({
		positionFrame: 0,
		transportState: 'stopped',
	});
	const animationFrameRef = useRef(0);
	const [compositorState, setCompositorState] = useState('pending');
	const [mediaErrorRevision, setMediaErrorRevision] = useState(0);
	const compositorStateRef = useRef('pending');
	const positionSelection = useAudioEditorTelemetrySelector(
		controller,
		(value) => {
			const nextFrame = Math.max(0, Number(value.positionFrame) || 0);
			const state = previewPositionSelectionRef.current;
			const nextInterval = findVideoPreviewTimelineInterval(
				compositorTimelineRef.current.intervals,
				nextFrame,
			);
			const gpuPlaying = value.transportState === 'playing'
				&& compositorStateRef.current !== 'pending'
				&& compositorStateRef.current !== 'fallback';
			const sampleRate = Math.max(1, Number(controller.engine?.sampleRate) || 48_000);
			const actualAdvance = nextFrame - state.observedFrame;
			// Telemetry normally arrives every 50 ms. Allow a generous delayed
			// sample before treating a forward jump as an explicit transport seek.
			const maximumExpectedAdvance = sampleRate * (
				Math.max(0.001, Number(value.playbackRate) || 1) * 0.2 + 0.1
			);
			const discontinuity = actualAdvance < 0
				|| actualAdvance > maximumExpectedAdvance;
			const shouldPublish = !gpuPlaying
				|| !state.gpuPlaying
				|| nextInterval !== state.interval
				|| discontinuity;
			state.gpuPlaying = gpuPlaying;
			state.interval = nextInterval;
			state.observedFrame = nextFrame;
			if (shouldPublish && (
				state.published.frame !== nextFrame
				|| gpuPlaying
			)) state.published = { frame: nextFrame };
			return state.published;
		},
	);
	const positionFrame = positionSelection.frame;
	const transportState = useAudioEditorTelemetrySelector(
		controller,
		(value) => value.transportState || 'stopped',
	);
	const playbackRate = useAudioEditorTelemetrySelector(
		controller,
		(value) => Math.max(0.001, Number(value.playbackRate) || 1),
	);
	const project = snapshot.project;
	const videoEffectBypass = useMemo(
		() => createVideoPreviewEffectBypass(snapshot.videoEffectPlaybackBypass),
		[snapshot.videoEffectPlaybackBypass],
	);
	const referenceCanvas = useMemo(() => {
		if (!project) return { width: 1_280, height: 720 };
		try {
			return resolveVideoExportCanvas(project);
		} catch {
			return { width: 1_280, height: 720 };
		}
	}, [project]);
	const layers = useMemo(() => {
		if (!project) return [];
		try {
			return resolveActiveVideoLayers(project, positionFrame);
		} catch {
			return [];
		}
	}, [positionFrame, project]);
	const missingSourceIds = useMemo(
		() => new Set(snapshot.missingSourceIds || []),
		[snapshot.missingSourceIds],
	);
	const compositorTimeline = useMemo(
		() => {
			void mediaErrorRevision;
			return createVideoPreviewTimeline(
				project,
				controller,
				missingSourceIds,
				failedVideoSourcesRef.current,
			);
		},
		[controller, mediaErrorRevision, missingSourceIds, project],
	);
	const resolvedLayers = useMemo(() => {
		void mediaErrorRevision;
		return layers.map((layer) => ({
			...layer,
			clips: (layer.clips || []).map((entry) => {
				const visual = controller.actions.video?.getClipVisualData?.(entry.clipId)
					|| controller.actions.timeline.getClipVisualData?.(entry.clipId);
				const sourceUrl = visual?.mediaUrl || visual?.url || null;
				return {
					...entry,
					sourceUrl,
					available: Boolean(
						entry.source
						&& sourceUrl
						&& visual?.available !== false
						&& !missingSourceIds.has(entry.sourceId)
						&& failedVideoSourcesRef.current.get(entry.clipId) !== sourceUrl,
					),
				};
			}),
		}));
	}, [controller, layers, mediaErrorRevision, missingSourceIds]);
	const activeEntries = resolvedLayers.flatMap((layer) => layer.clips);
	const renderableEntries = activeEntries.filter((entry) => entry.available);
	const unavailableCount = activeEntries.length - renderableEntries.length;
	const topActiveEntry = [...activeEntries].reverse().find((entry) => entry.opacity > 0) || null;
	const activeEffectCount = activeEntries.reduce((count, entry) => (
		count + videoEffectBypass.activeEffectCount(entry.clipId, entry.clip?.videoEffects || EMPTY_VIDEO_EFFECT_STACK)
	), 0);
	const updateCompositorState = useCallback((nextState) => {
		if (compositorStateRef.current === nextState) return;
		compositorStateRef.current = nextState;
		setCompositorState(nextState);
	}, []);
	const renderPreviewFrame = useCallback(function renderPreviewFrameCallback() {
		animationFrameRef.current = 0;
		const compositor = compositorRef.current;
		if (!compositor) return;
		const playhead = playheadRef.current;
		let timelineFrame = playhead.positionFrame;
		if (playhead.transportState === 'playing') {
			const engineFrame = Number(controller.engine?.getPositionFrames?.());
			if (Number.isFinite(engineFrame)) timelineFrame = Math.max(0, engineFrame);
		}
		const layersSynchronized = synchronizeVideoPreviewCompositorLayers(
			compositorLayersRef.current,
			compositorLayerPoolRef.current,
			compositorTimelineRef.current,
			timelineFrame,
			videoElementsRef.current,
			videoEffectBypass,
		);
		if (layersSynchronized) {
			releaseRetiredVideoPreviewElements(compositor, retiredVideoElementsRef.current);
		}
		let renderedCount;
		try {
			renderedCount = compositor.render(compositorLayersRef.current, renderOptionsRef.current);
		} catch {
			updateCompositorState('fallback');
			return;
		}
		const nextState = renderedCount < 0
			? 'fallback'
			: renderedCount > 0 ? 'ready' : 'webgl';
		updateCompositorState(nextState);
		if (renderedCount >= 0 && playhead.transportState === 'playing') {
			animationFrameRef.current = requestAnimationFrame(renderPreviewFrameCallback);
		}
	}, [controller, updateCompositorState, videoEffectBypass]);
	const requestPreviewFrame = useCallback(() => {
		if (animationFrameRef.current) return;
		animationFrameRef.current = requestAnimationFrame(renderPreviewFrame);
	}, [renderPreviewFrame]);
	const registerVideoElement = useCallback((clipId, element) => {
		const previousElement = videoElementsRef.current.get(clipId);
		if (compositorRef.current && previousElement && previousElement !== element) {
			retiredVideoElementsRef.current.push(previousElement);
		}
		if (element) {
			for (let index = retiredVideoElementsRef.current.length - 1; index >= 0; index -= 1) {
				if (retiredVideoElementsRef.current[index] !== element) continue;
				retiredVideoElementsRef.current[index] = retiredVideoElementsRef.current.at(-1);
				retiredVideoElementsRef.current.pop();
			}
			videoElementsRef.current.set(clipId, element);
		} else videoElementsRef.current.delete(clipId);
		requestPreviewFrame();
	}, [requestPreviewFrame]);
	const handleVideoMediaError = useCallback((clipId, sourceUrl, element) => {
		if (!clipId) return;
		failedVideoSourcesRef.current.set(clipId, sourceUrl);
		const clipState = compositorTimelineRef.current.clipStateById.get(clipId);
		if (clipState) clipState.available = false;
		if (videoElementsRef.current.get(clipId) === element) {
			videoElementsRef.current.delete(clipId);
		}
		if (compositorRef.current && element) {
			let alreadyRetired = false;
			for (let index = 0; index < retiredVideoElementsRef.current.length; index += 1) {
				if (retiredVideoElementsRef.current[index] === element) alreadyRetired = true;
			}
			if (!alreadyRetired) retiredVideoElementsRef.current.push(element);
		}
		setMediaErrorRevision((revision) => revision + 1);
		requestPreviewFrame();
	}, [requestPreviewFrame]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return undefined;
		try {
			compositorRef.current = createVideoPreviewCompositor(canvas, {
				onContextLost: () => updateCompositorState('fallback'),
				onContextRestored: () => {
					updateCompositorState('webgl');
					requestPreviewFrame();
				},
			});
			updateCompositorState('webgl');
		} catch {
			compositorRef.current = null;
			updateCompositorState('fallback');
			return undefined;
		}
		const retiredVideoElements = retiredVideoElementsRef.current;
		const resizeObserver = typeof ResizeObserver === 'function'
			? new ResizeObserver(requestPreviewFrame)
			: null;
		resizeObserver?.observe(canvas);
		if (!resizeObserver) window.addEventListener('resize', requestPreviewFrame);
		return () => {
			resizeObserver?.disconnect();
			if (!resizeObserver) window.removeEventListener('resize', requestPreviewFrame);
			if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
			animationFrameRef.current = 0;
			compositorRef.current?.dispose();
			compositorRef.current = null;
			retiredVideoElements.length = 0;
		};
	}, [requestPreviewFrame, updateCompositorState]);

	useEffect(() => {
		const playhead = playheadRef.current;
		playhead.positionFrame = positionFrame;
		playhead.transportState = transportState;
		compositorTimelineRef.current = compositorTimeline;
		primeVideoPreviewCompositorPool(
			compositorLayerPoolRef.current,
			compositorTimeline.maxLayerCount,
		);
		renderOptionsRef.current.referenceWidth = referenceCanvas.width;
		renderOptionsRef.current.referenceHeight = referenceCanvas.height;
		requestPreviewFrame();
	}, [
		compositorTimeline,
		positionFrame,
		referenceCanvas.height,
		referenceCanvas.width,
		requestPreviewFrame,
		transportState,
	]);

	return (
		<div
			className="kw-audio-editor__video-preview"
			data-video-preview
			data-active-clip-id={topActiveEntry?.clipId || ''}
			data-active-clip-ids={activeEntries.map((entry) => entry.clipId).join(' ')}
			data-active-track-count={resolvedLayers.length}
			data-renderable-clip-count={renderableEntries.length}
			data-unavailable-clip-count={unavailableCount}
			data-active-video-effect-count={activeEffectCount}
			data-video-preview-renderer={compositorState}
		>
			{resolvedLayers.map((layer) => {
				const renderableClips = layer.clips.filter((entry) => entry.available);
				return (
					<div
						key={layer.trackId}
						className="kw-audio-editor__video-preview-layer"
						data-video-preview-layer
						data-track-id={layer.trackId}
						data-track-index={layer.trackIndex}
					>
						{renderableClips.map((entry) => (
							<VideoPreviewClip
								key={entry.clipId}
								entry={entry}
								transportState={transportState}
								transportPlaybackRate={playbackRate}
								copy={copy}
								onVideoElement={registerVideoElement}
								onFrameReady={requestPreviewFrame}
								onMediaError={handleVideoMediaError}
							/>
						))}
					</div>
				);
			})}
			<canvas
				ref={canvasRef}
				className="kw-audio-editor__video-preview-canvas"
				data-video-preview-canvas
				data-renderer-state={compositorState}
				aria-hidden="true"
			/>
			{!renderableEntries.length && (
				<div className="kw-audio-editor__video-preview-empty" role="status">
					{activeEntries.length ? copy.videoPreviewUnavailable : copy.videoPreviewEmpty}
				</div>
			)}
			{unavailableCount > 0 && renderableEntries.length > 0 && (
				<div
					className="kw-audio-editor__video-preview-status"
					data-video-preview-unavailable
					role="status"
				>
					{copy.videoPreviewUnavailable}
				</div>
			)}
			{activeEffectCount > 0 && compositorState === 'fallback' && (
				<div
					className="kw-audio-editor__video-preview-status kw-audio-editor__video-preview-renderer-warning"
					data-video-preview-renderer-warning
					role="status"
				>
					{copy.videoPreviewEffectsUnavailable}
				</div>
			)}
		</div>
	);
}

function VideoPreviewClip({
	entry,
	transportState,
	transportPlaybackRate,
	copy,
	onVideoElement,
	onFrameReady,
	onMediaError,
}) {
	const videoRef = useRef(null);
	const setVideoRef = useCallback((element) => {
		videoRef.current = element;
		onVideoElement?.(entry.clipId, element);
	}, [entry.clipId, onVideoElement]);
	const syncVideo = useCallback(() => {
		const video = videoRef.current;
		if (!video) return;
		const targetTime = Math.max(0, Number(entry.sourceTimeSeconds) || 0);
		if (Math.abs((Number(video.currentTime) || 0) - targetTime) > 0.08) {
			try {
				video.currentTime = targetTime;
			} catch {
				// Metadata can still be loading; media readiness callbacks retry the seek.
			}
		}
		video.playbackRate = Math.max(
			0.0625,
			Math.min(16, (Number(entry.playbackRate) || 1) * transportPlaybackRate),
		);
		if (transportState === 'playing') {
			void video.play?.().catch(() => undefined);
		} else video.pause?.();
	}, [
		entry.playbackRate,
		entry.sourceTimeSeconds,
		transportPlaybackRate,
		transportState,
	]);
	const handleMediaReady = useCallback(() => {
		syncVideo();
		onFrameReady?.();
	}, [onFrameReady, syncVideo]);
	const handleMediaError = useCallback(() => {
		const video = videoRef.current;
		video?.pause?.();
		onMediaError?.(entry.clipId, entry.sourceUrl, video);
	}, [entry.clipId, entry.sourceUrl, onMediaError]);

	useEffect(() => {
		syncVideo();
	}, [syncVideo]);

	useEffect(() => () => {
		videoRef.current?.pause?.();
	}, []);

	const opacity = Math.max(0, Math.min(1, Number(entry.opacity) || 0));
	return (
		<video
			ref={setVideoRef}
			className="kw-audio-editor__video-preview-clip"
			data-video-preview-clip
			data-clip-id={entry.clipId}
			data-transition-role={entry.role || 'single'}
			data-opacity={opacity}
			src={entry.sourceUrl}
			muted
			playsInline
			preload="auto"
			aria-label={`${copy.panelVideoPreview}: ${entry.clip?.title || entry.source?.name || copy.videoClip}`}
			style={{
				opacity,
				mixBlendMode: entry.role === 'incoming' ? 'plus-lighter' : 'normal',
			}}
			onLoadedMetadata={handleMediaReady}
			onLoadedData={handleMediaReady}
			onCanPlay={handleMediaReady}
			onSeeked={onFrameReady}
			onError={handleMediaError}
		/>
	);
}
