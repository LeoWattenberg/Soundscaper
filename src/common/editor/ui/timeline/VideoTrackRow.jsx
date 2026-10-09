
import { useMemo, useRef, useState } from 'react';

import { framesToSeconds, projectClipsToViewport } from '../../design-system-adapters.js';
import { createTimelineViewportClipIndex } from '../../design-system-adapters/timeline-viewport-index.ts';
import { isVisualTimelineClipKind } from '../timeline-media-presence.ts';
import { AutomaticCrossfadeOverlays } from './TrackOverlapOverlays.jsx';
import { analyzeVideoClipOverlaps, projectVideoOverlapPresentation } from './video-overlap-presentation.ts';
import { TimeSelectionOverlay } from './TimelineOverlayComponents.jsx';
import { VideoFilmstripClip } from './VideoFilmstrip.jsx';
import { VideoTrackControls } from './VideoTrackControls.jsx';
import { timelineContentLeft } from './timeline-scroll-space.ts';
import { useTrackRowFocusNavigation } from './useTrackRowFocusNavigation.js';
import { extendTrackRowSelection } from './track-row-selection-extension.ts';

export function VideoTrackRow({
	controller,
	presentationProject,
	track,
	visualHeight,
	trackClips,
	clipLookup,
	sourceLookup,
	trackIndex,
	trackCount,
	isFlatNavigation,
	trackBaseTabIndex,
	panelWidth,
	trackHeaderWidth = panelWidth,
	renderViewportStartFrame,
	viewportDurationFrames,
	pixelsPerSecond,
	sampleRate,
	timelineWidth,
	verticalRulerWidth,
	timeSelection,
	rangeSelected,
	selectedTrackId,
	selectedClipId,
	selectedClipIdSet,
	draggingClipIds,
	clipDragPreview,
	projectBinDragPreview,
	blocked,
	copy,
	run,
	onMenu,
	onOpenClipMenu,
	onOpenClipProperties = undefined,
	clipStyle = 'colourful',
	onFocusTimelineRuler,
	onFocusTrackContainer,
	onFocusTrackPanelControl,
	onFocusTrackClip,
	onFocusSelectionToolbar,
}) {
	const trackWindowRef = useRef(null);
	const [renameRequest, setRenameRequest] = useState(null);
	const renameBlockedRef = useRef(blocked || track.locked);
	renameBlockedRef.current = blocked || track.locked;
	const renameRequestIdRef = useRef(0);
	const trackHeight = visualHeight;
	const clips = useMemo(() => {
		const projected = [...trackClips];
		if (clipDragPreview) {
			const previews = clipDragPreview.previews || [clipDragPreview];
			const previewIds = new Set(previews.map((preview) => preview.clipId));
			const stationary = projected.filter((clip) => !previewIds.has(clip.id));
			projected.splice(0, projected.length, ...stationary);
			for (const preview of previews) {
				if (track.id !== preview.trackId) continue;
				const draggedClip = clipLookup.get(preview.clipId);
				if (draggedClip && isVisualTimelineClipKind(draggedClip.kind)) {
					projected.push({ ...draggedClip, ...preview });
				}
			}
		}
		for (const preview of projectBinDragPreview?.previews || (projectBinDragPreview ? [projectBinDragPreview] : [])) {
			if (preview.trackId !== track.id || !isVisualTimelineClipKind(preview.clip?.kind)) continue;
			projected.push({
				...preview.clip,
				timelineStartFrame: preview.timelineStartFrame,
				groupId: null,
				projectBinClipId: preview.clip.id,
			});
		}
		return projected;
	}, [clipDragPreview, clipLookup, projectBinDragPreview, track.id, trackClips]);
	const viewportClipIndex = useMemo(() => clips.length > 128 && !clipDragPreview && !projectBinDragPreview
		? createTimelineViewportClipIndex(clips) : undefined, [clipDragPreview, clips, projectBinDragPreview]);
	const projection = useMemo(() => projectClipsToViewport(clips, {
		viewportStartFrame: renderViewportStartFrame,
		viewportDurationFrames,
		sampleRate,
	}, viewportClipIndex), [clips, renderViewportStartFrame, sampleRate, viewportClipIndex, viewportDurationFrames]);
	const windowLeft = framesToSeconds(projection.overscanStartFrame, { sampleRate }) * pixelsPerSecond;
	const windowFrames = Math.max(1, projection.overscanEndFrame - projection.overscanStartFrame);
	const windowWidth = Math.max(1, framesToSeconds(windowFrames, { sampleRate }) * pixelsPerSecond);
	const overlapAnalysis = useMemo(() => analyzeVideoClipOverlaps(clips), [clips]);
	const overlapPresentation = useMemo(() => projectVideoOverlapPresentation(
		overlapAnalysis,
		projection.overscanStartFrame,
		projection.overscanEndFrame,
		pixelsPerSecond,
		sampleRate,
	), [
		overlapAnalysis,
		pixelsPerSecond,
		projection.overscanEndFrame,
		projection.overscanStartFrame,
		sampleRate,
	]);
	const overlapState = overlapPresentation.invalid
		? 'invalid'
		: overlapPresentation.overlays.length
			? 'crossfade'
			: 'none';
	const {
		focusAfterPanel,
		focusAfterTrack,
		focusBeforeTrack,
		focusCurrentPanel,
		focusCurrentTrack,
		focusPanelVertical,
		focusTrackVertical,
		handleClipFocusCapture,
		handleClipKeyDownCapture,
		tabIndexFor,
	} = useTrackRowFocusNavigation({
		trackWindowRef,
		renderedClips: projection.clips,
		trackIndex,
		trackCount,
		isFlatNavigation,
		trackBaseTabIndex,
		hasTrackRuler: false,
		onFocusTimelineRuler,
		onFocusTrackContainer,
		onFocusTrackPanelControl,
		onFocusTrackClip,
		onFocusSelectionToolbar,
		onExtendTrackSelection: (index) => run(() => extendTrackRowSelection(controller, track.id, index)),
		onSelectClip: (clipId, options) => run(() => (
			controller.actions.timeline.selectClip(clipId, options)
		)),
		routeClipKey: (event, router) => {
			if (
				event.key === 'F2'
				&& !event.altKey
				&& !event.ctrlKey
				&& !event.metaKey
				&& !event.shiftKey
				&& !event.repeat
				&& !renameBlockedRef.current
				&& selectedClipIdSet.has(String(event.target.dataset.clipId))
			) {
				event.preventDefault();
				event.stopPropagation();
				setRenameRequest({
					clipId: String(event.target.dataset.clipId),
					id: ++renameRequestIdRef.current,
				});
				return true;
			}
			if (event.key !== 'Tab') return false;
			event.preventDefault();
			event.stopPropagation();
			const fadeHandle = !event.shiftKey && event.target.querySelector('[data-video-clip-fade-handle]:not(:disabled)');
			if (fadeHandle) fadeHandle.focus();
			else if (event.shiftKey) router.focusCurrentPanel(true);
			else router.focusAfterTrack();
			return true;
		},
	});

	return (
		<div
			className="audio-editor-track-row audio-editor-video-track-row"
			data-track-row
			data-video-track
			data-track-id={track.id}
			data-track-index={trackIndex}
			data-collapsed="false"
			data-hidden={track.hidden ? 'true' : 'false'}
			data-video-overlap-state={overlapState}
			data-video-overlap-valid={overlapPresentation.invalid ? 'false' : 'true'}
			style={{ height: trackHeight }}
		>
			<VideoTrackControls
				controller={controller}
				track={track}
				panelWidth={trackHeaderWidth}
				selected={selectedTrackId === track.id}
				blocked={blocked}
				isFlatNavigation={isFlatNavigation}
				copy={copy}
				run={run}
				onMenu={onMenu}
				onOpenEffects={() => {
					const clip = clips.find((candidate) => selectedClipIdSet.has(candidate.id))
						|| clips.find((candidate) => candidate.kind === 'video');
					if (!clip) return;
					run(() => controller.actions.timeline.selectClip(clip.id));
					onOpenClipProperties?.(clip.id);
				}}
				effectsAvailable={clips.some((clip) => clip.kind === 'video')}
				onTabOut={focusAfterPanel}
				onShiftTabOut={focusCurrentTrack}
				onNavigateVertical={focusPanelVertical}
			/>
			<div
				className="audio-editor-track-lane audio-editor-video-track-lane"
				data-track-lane
				data-track-id={track.id}
				data-selected={selectedTrackId === track.id}
				aria-invalid={overlapPresentation.invalid ? 'true' : undefined}
				aria-label={track.name}
				style={{ marginLeft: panelWidth, width: timelineWidth + verticalRulerWidth, height: trackHeight }}
				onClick={(event) => {
					if (event.target.closest('[data-clip-id]')) return;
					run(() => controller.actions.timeline.selectTrack(track.id));
				}}
			>
				<div
					ref={trackWindowRef}
					className="audio-editor-track-window audio-editor-video-track-window"
					style={{ left: timelineContentLeft(windowLeft), width: windowWidth }}
					onFocusCapture={handleClipFocusCapture}
					onKeyDownCapture={handleClipKeyDownCapture}
				>
					<div
						className="track audio-editor-video-track-surface"
						role="group"
						aria-label={track.name}
						tabIndex={tabIndexFor(0)}
						onFocus={(event) => {
							if (event.target !== event.currentTarget) return;
							if (selectedTrackId !== track.id) run(() => controller.actions.timeline.selectTrack(track.id));
						}}
						onKeyDown={(event) => {
							if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
							if (event.key === 'Tab') {
								event.preventDefault();
								if (event.shiftKey) focusBeforeTrack();
								else focusCurrentPanel();
							} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
								event.preventDefault();
								focusTrackVertical(event.key === 'ArrowDown' ? 1 : -1, event.shiftKey);
							}
						}}
					>
						{projection.clips.map((clip) => (
							<VideoFilmstripClip
								key={`${clip.projectBinClipId ? 'project-bin-' : ''}${clip.id}`}
								controller={controller}
								project={presentationProject}
								clip={clip}
								source={sourceLookup.get(clip.sourceId)}
								overscanStartFrame={projection.overscanStartFrame}
								overscanEndFrame={projection.overscanEndFrame}
								pixelsPerSecond={pixelsPerSecond}
								sampleRate={sampleRate}
								selected={selectedClipIdSet.size
									? selectedClipIdSet.has(clip.id)
									: String(selectedClipId) === String(clip.id)}
								dragging={Boolean(draggingClipIds?.has(clip.id))}
								invalidOverlap={overlapPresentation.invalidClipIds.has(clip.id)}
								hidden={track.hidden}
								blocked={blocked}
								copy={copy}
								color={clip.color === 'auto' ? track.color : clip.color}
								clipStyle={clipStyle}
								run={run}
								onFadeTabOut={focusAfterTrack}
								onOpenMenu={onOpenClipMenu}
								onRename={renameBlockedRef.current ? undefined : (title) => {
									const nextTitle = String(title).trim();
									if (renameBlockedRef.current || !nextTitle) return;
									run(() => controller.actions.clip.update(clip.id, { title: nextTitle }));
								}}
								renameRequestId={renameRequest?.clipId === String(clip.id) ? renameRequest.id : undefined}
								onRenameFinished={() => setRenameRequest((current) => (
									current?.clipId === String(clip.id) ? null : current
								))}
							/>
						))}
					</div>
					<AutomaticCrossfadeOverlays overlays={overlapPresentation.overlays} />
				</div>
				{rangeSelected && <TimeSelectionOverlay
					selection={timeSelection}
					pixelsPerSecond={pixelsPerSecond}
				/>}
			</div>
		</div>
	);
}
