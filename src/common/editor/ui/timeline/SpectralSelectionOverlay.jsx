import { useEffect, useRef, useState } from 'react';
import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';

import { framesToSeconds } from '../../design-system-adapters.js';
import {
	normalizeSpectrogramScale,
	spectralSelectionState,
	spectrogramFrequencyAtFraction,
	spectrogramFrequencyFraction,
} from './geometry.ts';
import { clamp } from './track-row-helpers.jsx';

export function SpectralSelectionOverlay({
	selection,
	track,
	displayMode,
	trackHeight,
	windowWidth,
	overscanStartFrame,
	pixelsPerSecond,
	sampleRate,
	maximumFrame,
	disabled,
	copy,
	onCommit,
}) {
	const dragRef = useRef(null);
	const initial = spectralSelectionState(selection);
	const previewRef = useRef(initial);
	const [preview, setPreview] = useState(initial);
	const displayMinimum = Math.max(0, Number(track.spectrogram?.minimumFrequency) || 0);
	const displayMaximum = Math.max(
		displayMinimum + 1,
		Math.min(sampleRate / 2, Number(track.spectrogram?.maximumFrequency) || sampleRate / 2),
	);
	const scale = normalizeSpectrogramScale(track.spectrogram?.scale);
	const spectralHeight = displayMode === 'multiview' ? Math.max(1, Math.floor(trackHeight / 2)) : trackHeight;

	useEffect(() => {
		if (dragRef.current) return;
		const next = spectralSelectionState(selection);
		previewRef.current = next;
		setPreview(next);
	}, [selection]);

	const setPreviewState = (next) => {
		previewRef.current = next;
		setPreview(next);
	};
	const publish = (next) => {
		setPreviewState(next);
		onCommit(next);
	};
	const stopClick = (event) => {
		event.preventDefault();
		event.stopPropagation();
	};
	const beginDrag = (kind, event) => {
		if (disabled) return;
		stopClick(event);
		dragRef.current = {
			kind,
			pointerId: event.pointerId,
			windowRect: event.currentTarget.closest('.audio-editor-track-window')?.getBoundingClientRect(),
			laneRect: event.currentTarget.closest('[data-track-lane]')?.getBoundingClientRect(),
		};
		event.currentTarget.setPointerCapture?.(event.pointerId);
	};
	const moveDrag = (event) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		stopClick(event);
		const next = { ...previewRef.current };
		if (drag.kind === 'start-time' || drag.kind === 'end-time') {
			if (!drag.windowRect) return;
			const contentX = event.clientX - drag.windowRect.left - CLIP_CONTENT_OFFSET;
			const frame = Math.round(overscanStartFrame + Math.max(0, contentX) / pixelsPerSecond * sampleRate);
			if (drag.kind === 'start-time') next.startFrame = clamp(frame, 0, next.endFrame - 1);
			else next.endFrame = clamp(frame, next.startFrame + 1, maximumFrame);
		} else {
			if (!drag.laneRect) return;
			const verticalFraction = 1 - clamp((event.clientY - drag.laneRect.top) / spectralHeight, 0, 1);
			const frequency = Math.round(spectrogramFrequencyAtFraction(verticalFraction, scale, displayMinimum, displayMaximum));
			if (drag.kind === 'minimum-frequency') {
				next.minimumFrequency = clamp(frequency, 0, next.maximumFrequency - 1);
			} else next.maximumFrequency = clamp(frequency, next.minimumFrequency + 1, sampleRate / 2);
		}
		setPreviewState(next);
	};
	const endDrag = (event, cancelled = false) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		stopClick(event);
		dragRef.current = null;
		if (cancelled) {
			setPreviewState(spectralSelectionState(selection));
			return;
		}
		publish(previewRef.current);
	};
	const adjustTime = (edge, event) => {
		if (disabled) return;
		let requested = null;
		const amount = event.shiftKey ? Math.max(1, Math.round(sampleRate / 10)) : 1;
		if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') requested = preview[`${edge}Frame`] - amount;
		else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') requested = preview[`${edge}Frame`] + amount;
		else if (event.key === 'PageDown') requested = preview[`${edge}Frame`] - sampleRate;
		else if (event.key === 'PageUp') requested = preview[`${edge}Frame`] + sampleRate;
		else if (event.key === 'Home') requested = edge === 'start' ? 0 : preview.startFrame + 1;
		else if (event.key === 'End') requested = edge === 'start' ? preview.endFrame - 1 : maximumFrame;
		if (requested == null) return;
		stopClick(event);
		publish({
			...preview,
			[`${edge}Frame`]: edge === 'start'
				? clamp(requested, 0, preview.endFrame - 1)
				: clamp(requested, preview.startFrame + 1, maximumFrame),
		});
	};
	const adjustFrequency = (edge, event) => {
		if (disabled) return;
		let requested = null;
		const amount = event.shiftKey ? 100 : 10;
		const name = edge === 'minimum' ? 'minimumFrequency' : 'maximumFrequency';
		if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') requested = preview[name] - amount;
		else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') requested = preview[name] + amount;
		else if (event.key === 'PageDown') requested = preview[name] - 1_000;
		else if (event.key === 'PageUp') requested = preview[name] + 1_000;
		else if (event.key === 'Home') requested = edge === 'minimum' ? 0 : preview.minimumFrequency + 1;
		else if (event.key === 'End') requested = edge === 'minimum' ? preview.maximumFrequency - 1 : sampleRate / 2;
		if (requested == null) return;
		stopClick(event);
		publish({
			...preview,
			[name]: edge === 'minimum'
				? clamp(requested, 0, preview.maximumFrequency - 1)
				: clamp(requested, preview.minimumFrequency + 1, sampleRate / 2),
		});
	};

	// The window draws its clips CLIP_CONTENT_OFFSET pixels in, so the box that
	// marks a selection within them starts from the same origin.
	const startPixels = CLIP_CONTENT_OFFSET
		+ framesToSeconds(preview.startFrame - overscanStartFrame, { sampleRate }) * pixelsPerSecond;
	const endPixels = CLIP_CONTENT_OFFSET
		+ framesToSeconds(preview.endFrame - overscanStartFrame, { sampleRate }) * pixelsPerSecond;
	const left = clamp(startPixels, 0, windowWidth);
	const right = clamp(endPixels, 0, windowWidth);
	if (right <= left) return null;
	const lowFraction = spectrogramFrequencyFraction(preview.minimumFrequency, scale, displayMinimum, displayMaximum);
	const highFraction = spectrogramFrequencyFraction(preview.maximumFrequency, scale, displayMinimum, displayMaximum);
	const top = (1 - highFraction) * spectralHeight;
	const height = Math.max(2, (highFraction - lowFraction) * spectralHeight);
	const timeMaximumSeconds = framesToSeconds(maximumFrame, { sampleRate });
	const handleProps = (kind) => ({
		type: 'button',
		disabled,
		onClick: stopClick,
		onPointerDown: (event) => beginDrag(kind, event),
		onPointerMove: moveDrag,
		onPointerUp: endDrag,
		onPointerCancel: (event) => endDrag(event, true),
	});

	return (
		<div
			className="audio-editor-spectral-selection"
			data-spectral-selection
			style={{ left, top, width: Math.max(2, right - left), height }}
		>
			<button
				{...handleProps('start-time')}
				className="audio-editor-spectral-selection__handle audio-editor-spectral-selection__handle--time-start"
				role="slider"
				aria-orientation="horizontal"
				aria-label={copy.spectralTimeStartHandle}
				aria-valuemin={0}
				aria-valuemax={framesToSeconds(preview.endFrame - 1, { sampleRate })}
				aria-valuenow={framesToSeconds(preview.startFrame, { sampleRate })}
				aria-valuetext={`${framesToSeconds(preview.startFrame, { sampleRate }).toFixed(3)} s`}
				onKeyDown={(event) => adjustTime('start', event)}
			/>
			<button
				{...handleProps('end-time')}
				className="audio-editor-spectral-selection__handle audio-editor-spectral-selection__handle--time-end"
				role="slider"
				aria-orientation="horizontal"
				aria-label={copy.spectralTimeEndHandle}
				aria-valuemin={framesToSeconds(preview.startFrame + 1, { sampleRate })}
				aria-valuemax={timeMaximumSeconds}
				aria-valuenow={framesToSeconds(preview.endFrame, { sampleRate })}
				aria-valuetext={`${framesToSeconds(preview.endFrame, { sampleRate }).toFixed(3)} s`}
				onKeyDown={(event) => adjustTime('end', event)}
			/>
			<button
				{...handleProps('maximum-frequency')}
				className="audio-editor-spectral-selection__handle audio-editor-spectral-selection__handle--frequency-maximum"
				role="slider"
				aria-orientation="vertical"
				aria-label={copy.spectralMaximumHandle}
				aria-valuemin={preview.minimumFrequency + 1}
				aria-valuemax={sampleRate / 2}
				aria-valuenow={preview.maximumFrequency}
				aria-valuetext={`${Math.round(preview.maximumFrequency)} Hz`}
				onKeyDown={(event) => adjustFrequency('maximum', event)}
			/>
			<button
				{...handleProps('minimum-frequency')}
				className="audio-editor-spectral-selection__handle audio-editor-spectral-selection__handle--frequency-minimum"
				role="slider"
				aria-orientation="vertical"
				aria-label={copy.spectralMinimumHandle}
				aria-valuemin={0}
				aria-valuemax={preview.maximumFrequency - 1}
				aria-valuenow={preview.minimumFrequency}
				aria-valuetext={`${Math.round(preview.minimumFrequency)} Hz`}
				onKeyDown={(event) => adjustFrequency('minimum', event)}
			/>
		</div>
	);
}
