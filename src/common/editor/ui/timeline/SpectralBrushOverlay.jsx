/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef, useState } from 'react';

import '../audio-editor-design-system/25-spectral-brush.css';

import { planSpectralBrushGesture } from './spectral-brush-model.ts';

export function SpectralBrushOverlay({
	track,
	displayMode,
	trackHeight,
	windowWidth,
	overscanStartFrame,
	pixelsPerSecond,
	sampleRate,
	disabled,
	copy,
	onCommit,
}) {
	const dragRef = useRef(null);
	const [preview, setPreview] = useState(null);
	const laneHeight = displayMode === 'multiview' ? Math.max(1, Math.floor(trackHeight / 2)) : trackHeight;
	const minimumFrequency = Math.max(0, Number(track.spectrogram?.minimumFrequency) || 0);
	const maximumFrequency = Math.max(
		minimumFrequency + 1,
		Math.min(sampleRate / 2, Number(track.spectrogram?.maximumFrequency) || sampleRate / 2),
	);
	const geometry = (startX, startY, endX, endY) => ({
		startX,
		startY,
		endX,
		endY,
		laneWidth: windowWidth,
		laneHeight,
		overscanStartFrame,
		pixelsPerSecond,
		sampleRate,
		minimumFrequency,
		maximumFrequency,
		scale: track.spectrogram?.scale || 'mel',
	});
	const stopEvent = (event) => {
		event.preventDefault();
		event.stopPropagation();
	};
	const pointerPosition = (event) => {
		const bounds = event.currentTarget.getBoundingClientRect();
		return {
			x: Math.max(0, Math.min(windowWidth, event.clientX - bounds.left)),
			y: Math.max(0, Math.min(laneHeight, event.clientY - bounds.top)),
		};
	};
	const begin = (event) => {
		if (disabled) return;
		stopEvent(event);
		const point = pointerPosition(event);
		dragRef.current = { pointerId: event.pointerId, ...point };
		setPreview({ startX: point.x, startY: point.y, endX: point.x, endY: point.y });
		event.currentTarget.setPointerCapture?.(event.pointerId);
	};
	const move = (event) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		stopEvent(event);
		const point = pointerPosition(event);
		setPreview({ startX: drag.x, startY: drag.y, endX: point.x, endY: point.y });
	};
	const finish = (event, cancelled = false) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		stopEvent(event);
		dragRef.current = null;
		const point = pointerPosition(event);
		setPreview(null);
		if (!cancelled) onCommit(planSpectralBrushGesture(geometry(drag.x, drag.y, point.x, point.y)));
	};
	const createCenteredBrush = (event) => {
		if (disabled || (event.key !== 'Enter' && event.key !== ' ')) return;
		stopEvent(event);
		onCommit(planSpectralBrushGesture(geometry(
			windowWidth / 2,
			laneHeight / 2,
			windowWidth / 2,
			laneHeight / 2,
		)));
	};
	const previewStyle = preview ? {
		left: preview.startX - Math.max(4, Math.abs(preview.endX - preview.startX)),
		top: preview.startY - Math.max(4, Math.abs(preview.endY - preview.startY)),
		width: Math.max(8, Math.abs(preview.endX - preview.startX) * 2),
		height: Math.max(8, Math.abs(preview.endY - preview.startY) * 2),
	} : null;

	return (
		<div
			className="audio-editor-spectral-brush"
			data-spectral-brush
			role="button"
			tabIndex={disabled ? -1 : 0}
			aria-label={copy.spectralBrush}
			aria-disabled={disabled || undefined}
			style={{ height: laneHeight }}
			onKeyDown={createCenteredBrush}
			onPointerDown={begin}
			onPointerMove={move}
			onPointerUp={finish}
			onPointerCancel={(event) => finish(event, true)}
		>
			{previewStyle && <span className="audio-editor-spectral-brush__preview" style={previewStyle} />}
		</div>
	);
}
