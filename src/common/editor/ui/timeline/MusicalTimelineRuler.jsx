/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef } from 'react';
import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';

import { createMusicalRulerTicks } from './musical-ruler-model.ts';

const DEFAULT_HEIGHT = 40;
const MAXIMUM_CANVAS_DIMENSION = 32_000;

/** Viewport-bounded ruler for projects whose tempo or signature changes over time. */
export function MusicalTimelineRuler({
	pixelsPerSecond,
	scrollX = 0,
	width,
	viewportWidth,
	height = DEFAULT_HEIGHT,
	timeSelection = null,
	sampleRate,
	tempoMap,
	signatureMap,
	loopRegionEnabled = false,
	loopRegionStart = null,
	loopRegionEnd = null,
	onLoopRegionEnabledToggle,
}) {
	const canvasRef = useRef(null);
	const renderWidth = viewportWidth ?? width;
	useEffect(() => {
		const canvas = canvasRef.current;
		const context = canvas?.getContext('2d');
		if (!canvas || !context) return;
		const baseRatio = window.devicePixelRatio || 1;
		const ratio = Math.max(1, Math.min(
			baseRatio,
			MAXIMUM_CANVAS_DIMENSION / renderWidth,
			MAXIMUM_CANVAS_DIMENSION / height,
		));
		canvas.width = Math.max(1, Math.floor(renderWidth * ratio));
		canvas.height = Math.max(1, Math.floor(height * ratio));
		canvas.style.width = `${renderWidth}px`;
		canvas.style.height = `${height}px`;
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		const styles = getComputedStyle(canvas);
		const background = cssColor(styles, '--kw-editor-stage-raised', '#202124');
		const foreground = cssColor(styles, '--kw-editor-text', '#f5f5f5');
		const line = cssColor(styles, '--kw-editor-line', '#72757a');
		const accent = cssColor(styles, '--kw-editor-accent', '#8ab4f8');
		context.fillStyle = background;
		context.fillRect(0, 0, renderWidth, height);
		const middle = Math.floor(height / 2);
		if (timeSelection) {
			const startX = timeX(timeSelection.startTime, pixelsPerSecond, scrollX);
			const endX = timeX(timeSelection.endTime, pixelsPerSecond, scrollX);
			context.globalAlpha = 0.35;
			context.fillStyle = foreground;
			context.fillRect(startX, middle, endX - startX, height - middle);
			context.globalAlpha = 1;
		}
		if (loopRegionStart !== null && loopRegionEnd !== null) {
			const startX = timeX(loopRegionStart, pixelsPerSecond, scrollX);
			const endX = timeX(loopRegionEnd, pixelsPerSecond, scrollX);
			context.globalAlpha = loopRegionEnabled ? 0.3 : 0.14;
			context.fillStyle = accent;
			context.fillRect(startX, 0, endX - startX, middle);
			context.globalAlpha = 1;
			context.strokeStyle = accent;
			context.strokeRect(startX, 0, endX - startX, middle);
		}
		context.strokeStyle = line;
		context.beginPath();
		context.moveTo(CLIP_CONTENT_OFFSET, middle + 0.5);
		context.lineTo(renderWidth, middle + 0.5);
		context.stroke();
		const startFrame = Math.max(0, Math.floor(scrollX / pixelsPerSecond * sampleRate));
		const endFrame = Math.max(startFrame, Math.ceil(
			(scrollX + renderWidth) / pixelsPerSecond * sampleRate,
		));
		const ticks = createMusicalRulerTicks({
			tempoMap,
			signatureMap,
			sampleRate,
			startFrame,
			endFrame,
			pixelsPerFrame: pixelsPerSecond / sampleRate,
		});
		context.font = '11px system-ui, sans-serif';
		context.fillStyle = foreground;
		context.lineWidth = 1;
		for (const [index, tick] of ticks.entries()) {
			const x = CLIP_CONTENT_OFFSET + tick.frame / sampleRate * pixelsPerSecond - scrollX;
			if (x < CLIP_CONTENT_OFFSET || x > renderWidth) continue;
			const tickX = Math.floor(x) + 0.5;
			context.strokeStyle = tick.major ? foreground : line;
			context.beginPath();
			context.moveTo(tickX, tick.major ? 0 : height - (height - middle) * 0.3);
			context.lineTo(tickX, height);
			context.stroke();
			const next = ticks[index + 1];
			const labelRoom = !next || (next.frame - tick.frame) / sampleRate * pixelsPerSecond >= 46;
			if (tick.major || labelRoom) context.fillText(tick.label, x + 4, middle / 2 + 4);
		}
	}, [
		height, loopRegionEnabled, loopRegionEnd, loopRegionStart, pixelsPerSecond, renderWidth,
		sampleRate, scrollX, signatureMap, tempoMap, timeSelection,
	]);

	return <canvas
		ref={canvasRef}
		className="timeline-ruler"
		data-musical-map-ruler="true"
		aria-hidden="true"
		style={{ width: `${renderWidth}px`, height: `${height}px`, display: 'block' }}
		onClick={(event) => {
			if (!onLoopRegionEnabledToggle || loopRegionStart === null || loopRegionEnd === null) return;
			const bounds = event.currentTarget.getBoundingClientRect();
			const x = event.clientX - bounds.left;
			const y = event.clientY - bounds.top;
			if (y > height / 2) return;
			const startX = timeX(loopRegionStart, pixelsPerSecond, scrollX);
			const endX = timeX(loopRegionEnd, pixelsPerSecond, scrollX);
			if (x >= startX && x <= endX) onLoopRegionEnabledToggle();
		}}
	/>;
}

function timeX(seconds, pixelsPerSecond, scrollX) {
	return CLIP_CONTENT_OFFSET + seconds * pixelsPerSecond - scrollX;
}

function cssColor(styles, name, fallback) {
	return styles.getPropertyValue(name).trim() || fallback;
}
