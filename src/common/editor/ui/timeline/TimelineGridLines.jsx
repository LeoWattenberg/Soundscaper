/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useRef } from 'react';

import { createTimelineGridLines } from './timeline-grid-model.ts';

const MAXIMUM_CANVAS_DIMENSION = 32_000;
const MINOR_LINE_ALPHA = 0.45;

/**
 * Vertical grid lines behind the track lanes, one per visible ruler tick.
 *
 * The `viewport` variant is a zero-height block pinned under the ruler row and
 * beside the track panel, so a single viewport-sized canvas sits behind every
 * track and the empty stage below the last one. The `fill` variant covers one
 * output-dock lane. Both draw from the same tick model as the ruler canvas.
 */
export function TimelineGridLines({
	variant = 'viewport',
	scale,
	pixelsPerSecond,
	scrollX = 0,
	viewportWidth,
	height,
	sampleRate,
	top = 0,
	left = 0,
}) {
	const canvasRef = useRef(null);
	const width = Math.max(1, Math.floor(viewportWidth));
	const canvasHeight = Math.max(1, Math.floor(height));
	const lines = useMemo(() => createTimelineGridLines({
		scale,
		pixelsPerSecond,
		scrollX,
		viewportWidth: width,
		sampleRate,
	}), [pixelsPerSecond, sampleRate, scale, scrollX, width]);

	useEffect(() => {
		const canvas = canvasRef.current;
		const context = canvas?.getContext('2d');
		if (!canvas || !context) return;
		const ratio = Math.max(1, Math.min(
			window.devicePixelRatio || 1,
			MAXIMUM_CANVAS_DIMENSION / width,
			MAXIMUM_CANVAS_DIMENSION / canvasHeight,
		));
		canvas.width = Math.max(1, Math.floor(width * ratio));
		canvas.height = Math.max(1, Math.floor(canvasHeight * ratio));
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		context.clearRect(0, 0, width, canvasHeight);
		context.lineWidth = 1;
		context.strokeStyle = getComputedStyle(canvas).getPropertyValue('--kw-editor-stage-grid-major').trim()
			|| '#2d2f34';
		for (const major of [false, true]) {
			context.globalAlpha = major ? 1 : MINOR_LINE_ALPHA;
			context.beginPath();
			for (const line of lines) {
				if (line.major !== major) continue;
				context.moveTo(line.x + 0.5, 0);
				context.lineTo(line.x + 0.5, canvasHeight);
			}
			context.stroke();
		}
		context.globalAlpha = 1;
	}, [canvasHeight, lines, width]);

	return (
		<div
			className="audio-editor-timeline-grid"
			data-timeline-grid={variant}
			aria-hidden="true"
			style={variant === 'viewport'
				? { top, left, marginLeft: left, width }
				: { width }}
		>
			<canvas
				ref={canvasRef}
				className="audio-editor-timeline-grid__canvas"
				data-timeline-grid-canvas="true"
				style={{ width, height: canvasHeight }}
			/>
		</div>
	);
}
