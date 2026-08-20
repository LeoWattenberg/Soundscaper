import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GhostButton, Icon } from '@dilsonspickles/components';

import { framesToSeconds, projectClipsToViewport } from '../../design-system-adapters.js';
import { AutomaticCrossfadeOverlays, createVideoOverlapPresentation } from './TrackOverlapOverlays.jsx';
import { TrackNameEditor } from './TrackControls.jsx';
import { clipGroups, focusFirst, normalizeClipSemantics } from './timeline-navigation.js';
import { VideoFilmstripClip } from './VideoFilmstrip.jsx';

export function VideoTrackRow({
	controller,
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
	viewportStartFrame,
	viewportDurationFrames,
	pixelsPerSecond,
	sampleRate,
	timelineWidth,
	verticalRulerWidth,
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
	onFocusTimelineRuler,
	onFocusTrackContainer,
	onFocusTrackPanelControl,
	onFocusTrackClip,
	onFocusSelectionToolbar,
}) {
	const trackWindowRef = useRef(null);
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
				if (draggedClip?.kind === 'video') projected.push({ ...draggedClip, ...preview });
			}
		}
		for (const preview of projectBinDragPreview?.previews || (projectBinDragPreview ? [projectBinDragPreview] : [])) {
			if (preview.trackId !== track.id || preview.clip?.kind !== 'video') continue;
			projected.push({
				...preview.clip,
				timelineStartFrame: preview.timelineStartFrame,
				groupId: null,
				projectBinClipId: preview.clip.id,
			});
		}
		return projected;
	}, [clipDragPreview, clipLookup, projectBinDragPreview, track.id, trackClips]);
	const projection = useMemo(() => projectClipsToViewport(clips, {
		viewportStartFrame,
		viewportDurationFrames,
		sampleRate,
	}), [clips, sampleRate, viewportDurationFrames, viewportStartFrame]);
	const windowLeft = framesToSeconds(projection.overscanStartFrame, { sampleRate }) * pixelsPerSecond;
	const windowFrames = Math.max(1, projection.overscanEndFrame - projection.overscanStartFrame);
	const windowWidth = Math.max(1, framesToSeconds(windowFrames, { sampleRate }) * pixelsPerSecond);
	const overlapPresentation = useMemo(() => createVideoOverlapPresentation(
		clips,
		projection.overscanStartFrame,
		projection.overscanEndFrame,
		pixelsPerSecond,
		sampleRate,
	), [
		clips,
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
	const tabIndexFor = useCallback(
		(offset) => isFlatNavigation ? 0 : trackBaseTabIndex + trackIndex * 4 + offset,
		[isFlatNavigation, trackBaseTabIndex, trackIndex],
	);

	useEffect(() => {
		const root = trackWindowRef.current;
		if (!root) return undefined;
		const normalize = () => normalizeClipSemantics(root, {
			flat: isFlatNavigation,
			tabIndex: tabIndexFor(2),
		});
		normalize();
		const observer = new MutationObserver(normalize);
		observer.observe(root, {
			attributes: true,
			attributeFilter: ['role', 'tabindex'],
			childList: true,
			subtree: true,
		});
		return () => observer.disconnect();
	}, [isFlatNavigation, projection.clips, tabIndexFor]);

	const focusBeforeTrack = () => {
		if (trackIndex === 0) return onFocusTimelineRuler();
		const previousTrack = trackIndex - 1;
		if (onFocusTrackClip(previousTrack, true)) return true;
		if (onFocusTrackPanelControl(previousTrack, true)) return true;
		return onFocusTrackContainer(previousTrack);
	};
	const focusAfterTrack = () => {
		if (trackIndex + 1 < trackCount) return onFocusTrackContainer(trackIndex + 1);
		return onFocusSelectionToolbar();
	};
	const focusAfterPanel = () => {
		if (onFocusTrackClip(trackIndex)) return true;
		return focusAfterTrack();
	};

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
				panelWidth={panelWidth}
				selected={selectedTrackId === track.id}
				blocked={blocked}
				isFlatNavigation={isFlatNavigation}
				copy={copy}
				run={run}
				onMenu={onMenu}
				onTabOut={focusAfterPanel}
				onShiftTabOut={() => onFocusTrackContainer(trackIndex)}
				onNavigateVertical={(direction) => {
					const targetIndex = trackIndex + (direction === 'down' ? 1 : -1);
					if (targetIndex >= 0 && targetIndex < trackCount) onFocusTrackPanelControl(targetIndex);
				}}
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
					style={{ left: windowLeft, width: windowWidth }}
					onFocusCapture={(event) => {
						if (isFlatNavigation || !event.target.matches?.('[data-clip-id][role="group"]')) return;
						for (const clip of clipGroups(trackWindowRef.current)) clip.tabIndex = -1;
						event.target.tabIndex = tabIndexFor(2);
					}}
					onKeyDownCapture={(event) => {
						if (!event.target.matches?.('[data-clip-id][role="group"]')) return;
						if (event.key === 'Enter') {
							event.preventDefault();
							event.stopPropagation();
							run(() => controller.actions.timeline.selectClip(String(event.target.dataset.clipId), {
								additive: event.shiftKey,
								toggle: event.metaKey || event.ctrlKey,
							}));
							return;
						}
						if (event.key === 'Tab') {
							event.preventDefault();
							event.stopPropagation();
							if (event.shiftKey) onFocusTrackPanelControl(trackIndex, true);
							else focusAfterTrack();
							return;
						}
						if (
							event.altKey
							|| event.ctrlKey
							|| event.metaKey
							|| event.shiftKey
							|| (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
						) return;
						const clipElements = clipGroups(trackWindowRef.current);
						const currentIndex = clipElements.indexOf(event.target);
						if (currentIndex < 0 || clipElements.length < 2) return;
						event.preventDefault();
						event.stopPropagation();
						const direction = event.key === 'ArrowRight' ? 1 : -1;
						const next = clipElements[(currentIndex + direction + clipElements.length) % clipElements.length];
						if (!isFlatNavigation) {
							for (const clipElement of clipElements) {
								clipElement.tabIndex = clipElement === next ? tabIndexFor(2) : -1;
							}
						}
						focusFirst(next);
					}}
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
							if (event.key === 'Tab') {
								event.preventDefault();
								if (event.shiftKey) focusBeforeTrack();
								else onFocusTrackPanelControl(trackIndex);
							} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
								event.preventDefault();
								const targetIndex = trackIndex + (event.key === 'ArrowDown' ? 1 : -1);
								if (targetIndex >= 0 && targetIndex < trackCount) onFocusTrackContainer(targetIndex);
							}
						}}
					>
						{projection.clips.map((clip) => (
							<VideoFilmstripClip
								key={`${clip.projectBinClipId ? 'project-bin-' : ''}${clip.id}`}
								controller={controller}
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
								onOpenMenu={onOpenClipMenu}
							/>
						))}
					</div>
					<AutomaticCrossfadeOverlays overlays={overlapPresentation.overlays} />
				</div>
			</div>
		</div>
	);
}

export function VideoTrackControls({
	controller,
	track,
	panelWidth,
	selected,
	blocked,
	isFlatNavigation,
	copy,
	run,
	onMenu,
	onTabOut,
	onShiftTabOut,
	onNavigateVertical,
}) {
	const controlsRef = useRef(null);
	const [editingName, setEditingName] = useState(false);
	const controlTabIndex = isFlatNavigation ? 0 : -1;
	// Targeting is controller session state, so it is read through on each
	// render; toggling it republishes and this reads the new answer.
	const targeted = controller.actions.video.targets().videoTrackId === track.id;
	const handleKeyDown = (event) => {
		if (event.key === 'Tab') {
			const controls = [...controlsRef.current.querySelectorAll('button:not([disabled]), input:not([disabled])')];
			const currentIndex = controls.indexOf(document.activeElement);
			if (currentIndex < 0) return;
			event.preventDefault();
			if (event.shiftKey) {
				if (currentIndex > 0) focusFirst(controls[currentIndex - 1]);
				else onShiftTabOut?.();
			} else if (currentIndex < controls.length - 1) {
				focusFirst(controls[currentIndex + 1]);
			} else onTabOut?.();
		} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			event.preventDefault();
			onNavigateVertical?.(event.key === 'ArrowDown' ? 'down' : 'up');
		}
	};
	return (
		<div
			ref={controlsRef}
			className="audio-editor-video-track-controls track-control-panel"
			data-track-header
			data-selected={selected ? 'true' : 'false'}
			style={{ width: panelWidth }}
			onClick={() => !selected && run(() => controller.actions.timeline.selectTrack(track.id))}
			onKeyDownCapture={handleKeyDown}
		>
			<div className="audio-editor-video-track-controls__title">
				<span className="audio-editor-video-track-controls__icon" aria-hidden="true">
					<Icon name="play" size={14} />
				</span>
				{editingName ? (
					<TrackNameEditor
						track={track}
						label={copy.trackName}
						blocked={blocked}
						controller={controller}
						run={run}
						onClose={() => setEditingName(false)}
					/>
				) : (
					<span
						data-track-name
						className="track-control-panel__track-name-text"
						title={track.name}
						onDoubleClick={() => !blocked && setEditingName(true)}
					>
						{track.name}
					</span>
				)}
				<GhostButton
					ariaLabel={copy.trackMenu || copy.tracksMenu}
					tabIndex={controlTabIndex}
					onClick={(event) => onMenu(event.currentTarget)}
				/>
			</div>
			<div className="audio-editor-video-track-controls__actions">
				<button
					type="button"
					className="audio-editor-video-track-control"
					data-track-action="target"
					aria-pressed={targeted}
					disabled={blocked}
					tabIndex={controlTabIndex}
					onClick={(event) => {
						event.stopPropagation();
						run(() => controller.actions.video.toggleTarget(track.id));
					}}
				>
					{copy.editTarget}
				</button>
				<button
					type="button"
					className="audio-editor-video-track-control"
					data-track-action="mute"
					aria-pressed={Boolean(track.hidden)}
					disabled={blocked}
					tabIndex={controlTabIndex}
					onClick={(event) => {
						event.stopPropagation();
						run(() => controller.actions.track.update(track.id, { hidden: !track.hidden }));
					}}
				>
					{track.hidden ? (copy.videoVisible || 'Show video') : (copy.videoHidden || 'Hide video')}
				</button>
				<button
					type="button"
					className="audio-editor-video-track-control"
					data-track-action="solo"
					aria-pressed={Boolean(track.solo)}
					disabled={blocked}
					tabIndex={controlTabIndex}
					onClick={(event) => {
						event.stopPropagation();
						run(() => controller.actions.track.update(track.id, { solo: !track.solo }));
					}}
				>
					{copy.soloTrack || 'Solo'}
				</button>
				<button
					type="button"
					className="audio-editor-video-track-control"
					data-track-action="decrease-height"
					disabled={blocked}
					tabIndex={controlTabIndex}
					onClick={(event) => {
						event.stopPropagation();
						run(() => controller.actions.track.decreaseHeight(track.id));
					}}
				>
					{copy.decreaseTrackHeight}
				</button>
				<button
					type="button"
					className="audio-editor-video-track-control"
					data-track-action="increase-height"
					disabled={blocked}
					tabIndex={controlTabIndex}
					onClick={(event) => {
						event.stopPropagation();
						run(() => controller.actions.track.increaseHeight(track.id));
					}}
				>
					{copy.increaseTrackHeight}
				</button>
			</div>
		</div>
	);
}
