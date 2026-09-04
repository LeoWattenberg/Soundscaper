import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';
import { GhostButton } from '@soundscaper/design-system/GhostButton';
import { Icon } from '@soundscaper/design-system/Icon';
import { LabelMarker } from '@soundscaper/design-system/LabelMarker';

import { framesToSeconds } from '../../design-system-adapters.js';
import { TimeSelectionOverlay } from './TimelineOverlayComponents.jsx';
import { TrackNameEditor } from './TrackControls.jsx';
import { timelineContentLeft } from './timeline-scroll-space.ts';

export function LabelTrackRow({
	controller,
	track,
	visualHeight,
	trackIndex,
	panelWidth,
	trackHeaderWidth = panelWidth,
	timelineWidth,
	verticalRulerWidth,
	pixelsPerSecond,
	sampleRate,
	selection,
	timeSelection,
	rangeSelected,
	selected,
	blocked,
	copy,
	run,
	onMenu,
}) {
	const trackHeight = visualHeight;
	const laneRef = useRef(null);
	const [editingName, setEditingName] = useState(false);
	const [selectedLabelId, setSelectedLabelId] = useState(null);
	const [editingLabelId, setEditingLabelId] = useState(null);
	const addLabel = (event = null) => {
		if (blocked) return;
		const pointerFrame = event?.clientX != null && laneRef.current
			? frameAtLabelClientX(event.clientX, laneRef.current, pixelsPerSecond, sampleRate)
			: null;
		const startFrame = pointerFrame ?? selection?.startFrame ?? 0;
		const endFrame = pointerFrame ?? selection?.endFrame ?? startFrame;
		const labelId = run(() => controller.actions.labels.add(track.id, {
			title: '',
			startFrame,
			endFrame,
		}));
		if (labelId) {
			setSelectedLabelId(labelId);
			setEditingLabelId(labelId);
		}
	};
	return (
		<div
			className="audio-editor-track-row audio-editor-label-track-row"
			data-track-row
			data-label-track
			data-track-id={track.id}
			data-track-index={trackIndex}
			data-collapsed="false"
			style={{ height: trackHeight }}
		>
			<div
				className="audio-editor-label-track-controls"
				data-track-header
				data-selected={selected ? 'true' : 'false'}
				style={{ width: trackHeaderWidth }}
			>
				{selected && <span className="audio-editor-track-header-selection" aria-hidden="true" />}
				<div className="audio-editor-label-track-title">
					<Icon name="label" size={16} aria-hidden="true" />
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
							onDoubleClick={() => !blocked && setEditingName(true)}
						>
							{track.name}
						</span>
					)}
					<GhostButton
						ariaLabel={copy.trackMenu || copy.tracksMenu}
						tabIndex={-1}
						onClick={(event) => onMenu(event.currentTarget)}
					/>
				</div>
				<div className="audio-editor-label-track-actions">
					<Button variant="secondary" size="small" aria-label={copy.addLabel} disabled={blocked} onClick={() => addLabel()}>
						{copy.addLabel}
					</Button>
				</div>
			</div>
			<div
				ref={laneRef}
				className="audio-editor-track-lane audio-editor-label-lane"
				data-track-lane
				data-track-id={track.id}
				data-selected={selected}
				role="region"
				aria-label={track.name}
				style={{ marginLeft: panelWidth, width: timelineWidth + verticalRulerWidth, height: trackHeight }}
				onClick={(event) => {
					if (!event.target.closest('[data-label-id]')) {
						setSelectedLabelId(null);
						run(() => controller.actions.timeline.selectTrack(track.id));
					}
				}}
				onDoubleClick={(event) => {
					if (!event.target.closest('[data-label-id]')) addLabel(event);
				}}
			>
				{rangeSelected && <TimeSelectionOverlay
					selection={timeSelection}
					pixelsPerSecond={pixelsPerSecond}
				/>}
				{track.labels.map((label) => (
					<AudacityLabelMarker
						key={label.id}
						controller={controller}
						trackId={track.id}
						label={label}
						left={labelLaneContentX(label.startFrame, pixelsPerSecond, sampleRate)}
						trackHeight={trackHeight}
						pixelsPerSecond={pixelsPerSecond}
						sampleRate={sampleRate}
						laneRef={laneRef}
						selected={selectedLabelId === label.id}
						editing={editingLabelId === label.id}
						blocked={blocked}
						copy={copy}
						run={run}
						onSelect={() => setSelectedLabelId(label.id)}
						onEdit={() => setEditingLabelId(label.id)}
						onFinishEdit={() => setEditingLabelId(null)}
						onRemove={() => {
							setSelectedLabelId(null);
							setEditingLabelId(null);
							run(() => controller.actions.labels.remove(track.id, label.id));
						}}
					/>
				))}
			</div>
		</div>
	);
}

export function AudacityLabelMarker({
	controller,
	trackId,
	label,
	left,
	trackHeight,
	pixelsPerSecond,
	sampleRate,
	laneRef,
	selected,
	editing,
	blocked,
	copy,
	run,
	onSelect,
	onEdit,
	onFinishEdit,
	onRemove,
}) {
	const inputRef = useRef(null);
	const baselineRef = useRef(label);
	const pendingRef = useRef(null);
	const [preview, setPreview] = useState(null);
	const point = label.startFrame === label.endFrame;
	const displayed = preview || label;
	const displayedLeft = left + (displayed.startFrame - label.startFrame) / sampleRate * pixelsPerSecond;
	const displayedWidth = Math.max(1, (displayed.endFrame - displayed.startFrame) / sampleRate * pixelsPerSecond);

	useEffect(() => {
		if (!editing) return;
		inputRef.current?.focus();
		inputRef.current?.select();
	}, [editing]);

	const finishDrag = useCallback(() => {
		const pending = pendingRef.current;
		if (!pending) return;
		pendingRef.current = null;
		setPreview(null);
		run(() => controller.actions.labels.update(trackId, label.id, pending));
	}, [controller, label.id, run, trackId]);

	useEffect(() => {
		document.addEventListener('mouseup', finishDrag);
		document.addEventListener('pointerup', finishDrag);
		return () => {
			document.removeEventListener('mouseup', finishDrag);
			document.removeEventListener('pointerup', finishDrag);
		};
	}, [finishDrag]);

	const previewRange = (startFrame, endFrame) => {
		const changes = {
			startFrame: Math.max(0, Math.min(startFrame, endFrame)),
			endFrame: Math.max(0, Math.max(startFrame, endFrame)),
		};
		pendingRef.current = changes;
		setPreview({ ...label, ...changes });
	};
	const select = () => {
		onSelect();
		baselineRef.current = preview || label;
		run(() => controller.actions.timeline.selectTrack(trackId));
		run(() => controller.actions.timeline.setSelection(label.startFrame, label.endFrame));
	};
	return (
		<div
			className="audio-editor-label-marker"
			data-label-id={label.id}
			data-point-label={point ? 'true' : 'false'}
			onMouseUp={finishDrag}
			onPointerUp={finishDrag}
			style={{ left: timelineContentLeft(displayedLeft), width: displayedWidth }}
			role="group"
			tabIndex={0}
			aria-label={`${copy.editLabels}: ${label.title || copy.newLabel}`}
			onKeyDown={(event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					onEdit();
				} else if ((event.key === 'Delete' || event.key === 'Backspace') && !editing && !blocked) {
					event.preventDefault();
					onRemove();
				}
			}}
		>
			<LabelMarker
				text={label.title || copy.newLabel}
				type={point ? 'point' : 'region'}
				width={displayedWidth}
				stalkHeight={Math.max(24, trackHeight - 18)}
				selected={selected}
				onClick={select}
				onDoubleClick={() => !blocked && onEdit()}
				onSelect={() => {
					select();
					baselineRef.current = preview || label;
				}}
				onLabelMove={blocked ? undefined : (deltaX) => {
					const baseline = baselineRef.current || label;
					const deltaFrames = Math.round(deltaX / pixelsPerSecond * sampleRate);
					const duration = baseline.endFrame - baseline.startFrame;
					const startFrame = Math.max(0, baseline.startFrame + deltaFrames);
					previewRange(startFrame, startFrame + duration);
				}}
				onRegionResize={blocked ? undefined : ({ side, clientX }) => {
					const frame = frameAtLabelClientX(clientX, laneRef.current, pixelsPerSecond, sampleRate);
					if (side === 'left') previewRange(frame, label.endFrame);
					else previewRange(label.startFrame, frame);
				}}
			/>
			{editing && <input
				ref={inputRef}
				className="audio-editor-label-title-input"
				defaultValue={label.title}
				disabled={blocked}
				aria-label={`${copy.editLabels}: ${label.title || copy.newLabel}`}
				onClick={(event) => event.stopPropagation()}
				onBlur={(event) => {
					const title = event.currentTarget.value;
					if (title !== label.title) run(() => controller.actions.labels.update(trackId, label.id, { title }));
					onFinishEdit();
				}}
				onKeyDown={(event) => {
					if (event.key === 'Enter') event.currentTarget.blur();
					else if (event.key === 'Escape') {
						event.currentTarget.value = label.title;
						event.currentTarget.blur();
					}
				}}
			/>}
		</div>
	);
}

/**
 * Where a label frame is drawn inside its lane. Lanes start their content
 * CLIP_CONTENT_OFFSET pixels in, exactly as the ruler, the grid lines and the
 * playhead do, so a label placed at the playhead lands on the playhead.
 */
export function labelLaneContentX(frame, pixelsPerSecond, sampleRate) {
	return CLIP_CONTENT_OFFSET + framesToSeconds(frame, { sampleRate }) * pixelsPerSecond;
}

/** The inverse of {@link labelLaneContentX} for a pointer over a label lane. */
export function frameAtLabelClientX(clientX, lane, pixelsPerSecond, sampleRate) {
	if (!lane) return 0;
	const rect = lane.getBoundingClientRect();
	const contentX = clientX - rect.left - CLIP_CONTENT_OFFSET;
	return Math.max(0, Math.round(Math.max(0, contentX) / pixelsPerSecond * sampleRate));
}
