import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { resolveVideoExportCanvas } from '../../video-export.js';
import { createVideoKeyframeRenderStateProvider } from '../../video-keyframe-render-state-provider.ts';
import {
	isVideoKeyframePreviewFailureCurrent,
	isVideoKeyframePreviewStateError,
	resolveVideoKeyframePreviewState,
} from '../../video-keyframe-preview-state.ts';
import { resolveActiveVideoLayers } from '../../video-timeline.js';
import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import {
	createVideoPreviewCompositor,
	createVideoPreviewCompositorFallbackReport,
	shouldContinueVideoPreviewPlayback,
} from '../video-preview-compositor.js';
import { createVideoPreviewEffectBypass } from './video-preview-effect-bypass.ts';
import { useFramescaperVideoProxyPreviewPressure } from './framescaper-video-proxy-pressure.ts';
import VideoPreviewClip from './VideoPreviewClip.jsx';
import { composeProductVideoVisualPreviewLayers } from './product-video-visual-preview-composition.ts';
import { resolveVideoPreviewVisual } from './video-preview-visual.ts';
import { useProductVideoVisualPreviewSession } from './use-product-video-visual-preview-session.ts';
import { createVideoPreviewTimelineState } from './video-preview-timeline-state.js';
import {
	EMPTY_VIDEO_EFFECT_STACK,
	clearVideoPreviewCompositorLayers,
	findVideoPreviewTimelineInterval,
	primeVideoPreviewCompositorPool,
	releaseRetiredVideoPreviewElements,
	synchronizeVideoPreviewCompositorLayers,
} from './video-preview-compositor-pool.js';
import {
	createVideoPreviewFallbackLedgerLayers,
	resolveVideoPreviewRenderIssue,
	shouldHideVideoPreviewIdentityFallback,
} from './video-preview-fallback.ts';
import { publishEvaluatedVideoPreviewFrame } from './video-preview-external-display.ts';
import { resolveRegisteredVideoRetimePreview } from './video-preview-retime.ts';

export default function VideoPreviewPanel({ controller, snapshot, copy, run }) {
	const canvasRef = useRef(null);
	const compositorRef = useRef(null);
	const videoElementsRef = useRef(new Map());
	const compositorLayersRef = useRef([]);
	const composedLayersRef = useRef([]);
	const compositorLayerPoolRef = useRef([]);
	const compositorTimelineRef = useRef({ intervals: [], clipStateById: new Map(), maxLayerCount: 0 });
	const renderOptionsRef = useRef({ referenceWidth: 1_280, referenceHeight: 720 });
	const retiredVideoElementsRef = useRef([]);
	const displaySizesRef = useRef(new Map());
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
	const requestProductVisualFrameRef = useRef(() => {});
	const [compositorState, setCompositorState] = useState('pending');
	const [renderIssue, setRenderIssue] = useState(() => resolveVideoPreviewRenderIssue(null));
	const [mediaErrorRevision, setMediaErrorRevision] = useState(0);
	const [keyframeFailureProject, setKeyframeFailureProject] = useState(null);
	const compositorStateRef = useRef('pending');
	const renderIssueSignatureRef = useRef('');
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
	const project = snapshot.videoPreviewProject || snapshot.project;
	const canonicalProject = snapshot.project;
	const retimePreview = useMemo(() => resolveRegisteredVideoRetimePreview(
		project, typeof controller.actions.sequences?.retimeSet === 'function',
	), [controller, project]);
	const resolveClipPresentation = retimePreview.resolver?.resolveClipPresentation;
	const keyframeStateProvider = useMemo(() => {
		void project;
		return createVideoKeyframeRenderStateProvider();
	}, [project]);
	const resolveClipRenderState = useCallback(
		(request) => resolveVideoKeyframePreviewState(keyframeStateProvider, request),
		[keyframeStateProvider],
	);
	const videoEffectBypass = useMemo(
		() => createVideoPreviewEffectBypass(snapshot.videoEffectPlaybackBypass),
		[snapshot.videoEffectPlaybackBypass],
	);
	// The delivery an open export dialog is stating wins over the project's own
	// derived canvas, so a reframed delivery is previewed as it will be
	// delivered. Without it the one control whose purpose is reframing could not
	// be judged until the file existed.
	const deliveryCanvas = snapshot.videoDeliveryPreviewCanvas;
	const referenceCanvas = useMemo(() => {
		if (!project) return { width: 1_280, height: 720 };
		try {
			return resolveVideoExportCanvas(project, deliveryCanvas ?? {});
		} catch {
			try {
				return resolveVideoExportCanvas(project);
			} catch {
				return { width: 1_280, height: 720 };
			}
		}
	}, [deliveryCanvas, project]);
	const {
		sessionRef: visualSessionRef,
		state: visualPreviewState,
		updateFrame: updateVisualPreviewFrame,
		resolveTransitionWeight,
	} = useProductVideoVisualPreviewSession({
		owner: controller,
		project: canonicalProject,
		width: referenceCanvas.width,
		height: referenceCanvas.height,
		requestFrame: () => { requestProductVisualFrameRef.current(); },
	});
	const layerResolution = useMemo(() => {
		if (!project) return { layers: [], keyframeFailed: false };
		try {
			return { layers: resolveActiveVideoLayers(project, positionFrame, {
				renderCanvas: referenceCanvas,
				resolveClipRenderState,
				resolveClipPresentation,
				resolveTransitionWeight,
			}), keyframeFailed: false };
		} catch (error) {
			return { layers: [], keyframeFailed: isVideoKeyframePreviewStateError(error) };
		}
	}, [positionFrame, project, referenceCanvas, resolveClipPresentation, resolveClipRenderState, resolveTransitionWeight]);
	const layers = layerResolution.layers;
	const keyframePreviewFailed = retimePreview.failed || layerResolution.keyframeFailed
		|| isVideoKeyframePreviewFailureCurrent(keyframeFailureProject, project);
	useEffect(() => {
		setKeyframeFailureProject(null);
	}, [project]);
	const missingSourceIds = useMemo(
		() => new Set(snapshot.missingSourceIds || []),
		[snapshot.missingSourceIds],
	);
	const compositorTimeline = useMemo(
		() => {
			void mediaErrorRevision;
			return createVideoPreviewTimelineState(
				project,
				controller,
				missingSourceIds,
				failedVideoSourcesRef.current,
				referenceCanvas,
				keyframeStateProvider,
				resolveClipPresentation,
				resolveTransitionWeight,
			);
		},
		[controller, keyframeStateProvider, mediaErrorRevision, missingSourceIds, project, referenceCanvas, resolveClipPresentation, resolveTransitionWeight],
	);
	const resolvedLayers = useMemo(() => {
		void mediaErrorRevision;
		return layers.map((layer) => ({
			...layer,
			clips: (layer.clips || []).map((entry) => {
				const visual = resolveVideoPreviewVisual(controller, entry.clipId, entry.sourceId);
				const sourceUrl = visual?.mediaUrl || visual?.url || null;
				return {
					...entry,
					sourceUrl,
					available: Boolean(
						entry.source
						&& sourceUrl
						&& visual?.available !== false
						&& (visual?.mediaKind === 'proxy' || !missingSourceIds.has(entry.sourceId))
						&& failedVideoSourcesRef.current.get(entry.clipId) !== sourceUrl,
					),
				};
			}),
		}));
	}, [controller, layers, mediaErrorRevision, missingSourceIds]);
	const activeEntries = resolvedLayers.flatMap((layer) => layer.clips);
	useFramescaperVideoProxyPreviewPressure({ reporter: controller.actions.video?.reportPreviewPressure || null, entries: activeEntries, elements: videoElementsRef, canvas: canvasRef, referenceWidth: referenceCanvas.width, referenceHeight: referenceCanvas.height, playing: transportState === 'playing', run });
	const renderableMediaEntries = keyframePreviewFailed
		? []
		: activeEntries.filter((entry) => entry.available);
	const renderableCount = renderableMediaEntries.length + visualPreviewState.renderableEntryCount;
	const unavailableCount = activeEntries.length - renderableMediaEntries.length;
	const topActiveEntry = [...activeEntries].reverse().find((entry) => entry.opacity > 0) || null;
	const activeEffectCount = activeEntries.reduce((count, entry) => (
		count + videoEffectBypass.activeEffectCount(entry.clipId, entry.videoEffects || entry.clip?.videoEffects || EMPTY_VIDEO_EFFECT_STACK)
	), 0);
	const constructorFallbackLayers = useMemo(() => createVideoPreviewFallbackLedgerLayers(
		keyframePreviewFailed ? [] : resolvedLayers,
		(clipId, effects) => videoEffectBypass.effectsFor(clipId, effects),
	), [keyframePreviewFailed, resolvedLayers, videoEffectBypass]);
	const updateCompositorState = useCallback((nextState) => {
		if (compositorStateRef.current === nextState) return;
		compositorStateRef.current = nextState;
		setCompositorState(nextState);
	}, []);
	const updateRenderIssue = useCallback((report) => {
		const issue = resolveVideoPreviewRenderIssue(report);
		const signature = [
			issue.requestedEffectCount,
			issue.omittedEffectIds.join('\u0000'),
			issue.requestedCompositionCount,
			issue.omittedCompositionClipIds.join('\u0000'),
		].join(':');
		if (renderIssueSignatureRef.current === signature) return;
		renderIssueSignatureRef.current = signature;
		setRenderIssue(issue);
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
		let layersSynchronized;
		try {
			layersSynchronized = synchronizeVideoPreviewCompositorLayers(
				compositorLayersRef.current, compositorLayerPoolRef.current,
				compositorTimelineRef.current, timelineFrame,
				videoElementsRef.current, videoEffectBypass, displaySizesRef.current,
			);
		} catch (error) {
			if (!isVideoKeyframePreviewStateError(error)) throw error;
			clearVideoPreviewCompositorLayers(
				compositorLayersRef.current, compositorLayerPoolRef.current,
			);
			setKeyframeFailureProject(project);
			updateCompositorState('fallback');
			return;
		}
		if (layersSynchronized) {
			releaseRetiredVideoPreviewElements(compositor, retiredVideoElementsRef.current);
		}
		try {
			const visualSession = visualSessionRef.current;
			const productFrame = visualSession?.resolve(timelineFrame) ?? null;
			composedLayersRef.current = composeProductVideoVisualPreviewLayers(
				compositorLayersRef.current, productFrame,
			);
			if (visualSession) updateVisualPreviewFrame(productFrame);
		} catch (error) {
			composedLayersRef.current = [];
			updateVisualPreviewFrame(null, error instanceof Error ? error.message : String(error));
			updateCompositorState('fallback');
			return;
		}
		let report;
		try {
			report = compositor.render(composedLayersRef.current, renderOptionsRef.current);
		} catch {
			report = createVideoPreviewCompositorFallbackReport(composedLayersRef.current);
		}
		updateRenderIssue(report);
		try {
			publishEvaluatedVideoPreviewFrame({ compositor, project, timelineFrame });
		} catch { /* clean-display failure must not stop the editor preview */ }
		const nextState = report.status === 'fallback'
			? 'fallback'
			: report.renderedEntryCount > 0 ? 'ready' : 'webgl';
		updateCompositorState(nextState);
		if (shouldContinueVideoPreviewPlayback(report, playhead.transportState)) {
			animationFrameRef.current = requestAnimationFrame(renderPreviewFrameCallback);
		}
	}, [controller, project, updateCompositorState, updateRenderIssue, updateVisualPreviewFrame,
		videoEffectBypass, visualSessionRef]);
	const requestPreviewFrame = useCallback(() => {
		if (animationFrameRef.current) return;
		animationFrameRef.current = requestAnimationFrame(renderPreviewFrame);
	}, [renderPreviewFrame]);
	requestProductVisualFrameRef.current = requestPreviewFrame;
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
	const handleVideoMediaError = useCallback((clipId, sourceId, sourceUrl, element) => {
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
		const releaseSourceVisual = controller.actions.video?.releaseSourceVisual;
		if (typeof releaseSourceVisual === 'function' && typeof run === 'function') {
			run(() => releaseSourceVisual(sourceId, sourceUrl));
		}
		setMediaErrorRevision((revision) => revision + 1);
		requestPreviewFrame();
	}, [controller, requestPreviewFrame, run]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return undefined;
		try {
			compositorRef.current = createVideoPreviewCompositor(canvas, {
				onContextLost: () => {
					updateRenderIssue(createVideoPreviewCompositorFallbackReport(
						composedLayersRef.current,
					));
					updateCompositorState('fallback');
				},
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
	}, [requestPreviewFrame, updateCompositorState, updateRenderIssue]);
	useEffect(() => {
		if (compositorRef.current || compositorStateRef.current !== 'fallback') return;
		updateRenderIssue(createVideoPreviewCompositorFallbackReport(
			composedLayersRef.current.length ? composedLayersRef.current : constructorFallbackLayers,
		));
	}, [constructorFallbackLayers, updateRenderIssue]);

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
			data-active-clip-id={visualPreviewState.activeClipIds.at(-1) || topActiveEntry?.clipId || ''}
			data-active-clip-ids={[...activeEntries.map((entry) => entry.clipId),
				...visualPreviewState.activeClipIds].join(' ')}
			data-active-track-count={resolvedLayers.length + visualPreviewState.activeTrackCount}
			data-renderable-clip-count={renderableCount}
			data-unavailable-clip-count={unavailableCount}
			data-active-video-effect-count={activeEffectCount}
			data-video-preview-requested-effect-count={renderIssue.requestedEffectCount}
			data-video-preview-omitted-effect-count={renderIssue.omittedEffectIds.length}
			data-video-preview-omitted-effect-ids={renderIssue.omittedEffectIds.join(' ')}
			data-video-preview-requested-composition-count={renderIssue.requestedCompositionCount}
			data-video-preview-omitted-composition-count={renderIssue.omittedCompositionClipIds.length}
			data-video-preview-omitted-composition-clip-ids={renderIssue.omittedCompositionClipIds.join(' ')}
			data-video-preview-renderer={compositorState}
			data-video-preview-keyframe-error={keyframePreviewFailed ? 'true' : 'false'}
			data-video-preview-visual-pending={visualPreviewState.pending ? 'true' : 'false'}
			data-video-preview-visual-error={visualPreviewState.error || ''}
			data-video-preview-visual-requested-count={visualPreviewState.requestedNodeIds.length}
			data-video-preview-visual-requested-node-ids={visualPreviewState.requestedNodeIds.join(' ')}
			data-video-preview-visual-consumed-count={visualPreviewState.consumedNodeIds.length}
			data-video-preview-visual-consumed-node-ids={visualPreviewState.consumedNodeIds.join(' ')}
			data-video-preview-visual-omitted-count={visualPreviewState.omittedNodeIds.length}
			data-video-preview-visual-omitted-node-ids={visualPreviewState.omittedNodeIds.join(' ')}
			data-video-preview-active-freeze-node-ids={visualPreviewState.activeFreezeNodeIds.join(' ')}
			data-video-preview-available-preset-ids={visualPreviewState.availablePresetIds.join(' ')}
		>
			{resolvedLayers.map((layer) => {
				const renderableClips = keyframePreviewFailed
					? []
					: layer.clips.filter((entry) => entry.available);
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
								hideIdentityFallback={shouldHideVideoPreviewIdentityFallback(
									compositorState,
									entry.renderDescription,
								)}
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
			{!renderableCount && !visualPreviewState.pending && (
				<div className="kw-audio-editor__video-preview-empty" role={keyframePreviewFailed || visualPreviewState.error ? 'alert' : 'status'}>
					{visualPreviewState.error
						? visualPreviewState.error
						: keyframePreviewFailed
						? copy.videoPreviewKeyframesUnavailable
							|| 'The video keyframe state is invalid. The program preview has been hidden.'
						: activeEntries.length ? copy.videoPreviewUnavailable : copy.videoPreviewEmpty}
				</div>
			)}
			{unavailableCount > 0 && renderableCount > 0 && (
				<div
					className="kw-audio-editor__video-preview-status"
					data-video-preview-unavailable
					role="status"
				>
					{copy.videoPreviewUnavailable}
				</div>
			)}
			{(renderIssue.requestedEffectCount > 0
				|| renderIssue.requestedCompositionCount > 0)
				&& compositorState === 'fallback' && (
				<div
					className="kw-audio-editor__video-preview-status kw-audio-editor__video-preview-renderer-warning"
					data-video-preview-renderer-warning
					role="status"
				>
					{renderIssue.requestedCompositionCount > 0
						? copy.videoPreviewCompositionUnavailable
						: copy.videoPreviewEffectsUnavailable}
					{(renderIssue.omittedEffectIds.length > 0
						|| renderIssue.omittedCompositionClipIds.length > 0) && (
						<small>{boundedOmissionSummary([
							...renderIssue.omittedEffectIds,
							...renderIssue.omittedCompositionClipIds,
						])}</small>
					)}
				</div>
			)}
		</div>
	);
}

function boundedOmissionSummary(effectIds) {
	const visible = effectIds.slice(0, 5);
	return effectIds.length > visible.length
		? `${visible.join(', ')} +${effectIds.length - visible.length}`
		: visible.join(', ');
}
