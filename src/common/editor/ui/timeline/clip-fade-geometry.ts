/* SPDX-License-Identifier: AGPL-3.0-only */

import { fadeEnvelope as clipFadeGain } from '../../design-system-adapters/validation.ts';
export { clipFadeGain };

export type ClipFadeEdge = 'in' | 'out';
export interface FadeClip {
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
}

export function fadeField(edge: ClipFadeEdge): 'fadeInFrames' | 'fadeOutFrames' {
	return edge === 'in' ? 'fadeInFrames' : 'fadeOutFrames';
}

export function fadeDurationAtPointer(
	edge: ClipFadeEdge, initial: number, startX: number, clientX: number,
	pixelsPerSecond: number, sampleRate: number, duration: number,
): number {
	const delta = Math.round((clientX - startX) / pixelsPerSecond * sampleRate);
	return Math.max(0, Math.min(duration, initial + (edge === 'in' ? delta : -delta)));
}

export function fadeDurationAtKey(
	key: string, shift: boolean, current: number, sampleRate: number, duration: number,
): number | null {
	if (key === 'Home') return 0;
	if (key === 'End') return duration;
	const direction = key === 'ArrowRight' || key === 'ArrowUp' ? 1
		: key === 'ArrowLeft' || key === 'ArrowDown' ? -1 : 0;
	if (!direction) return null;
	return Math.max(0, Math.min(duration, current + direction * Math.max(1, Math.round(sampleRate * (shift ? 0.1 : 0.01)))));
}

export function fadeOverlayGeometry(
	clip: FadeClip, viewportStart: number, viewportEnd: number, pixelsPerSecond: number, sampleRate: number,
): { left: number; width: number; fadeInX: number | null; fadeOutX: number | null; points: string } {
	const duration = clip.durationFrames;
	const start = Math.max(0, viewportStart - clip.timelineStartFrame);
	const end = Math.min(duration, viewportEnd - clip.timelineStartFrame);
	const scale = pixelsPerSecond / sampleRate;
	const width = Math.max(0, (end - start) * scale);
	const fadeIn = Math.min(duration, clip.fadeInFrames ?? 0);
	const fadeOut = Math.min(duration, clip.fadeOutFrames ?? 0);
	const handleX = (frame: number): number | null => frame < start || frame > end ? null : (frame - start) * scale;
	// Sample only the visible interval, adding exact knees to retain short fades.
	const frames = new Set([start, end]);
	for (const frame of [fadeIn, duration - fadeOut]) if (frame > start && frame < end) frames.add(frame);
	const steps = Math.max(1, Math.min(1024, Math.ceil(width / 2)));
	for (let index = 1; index < steps; index += 1) frames.add(start + (end - start) * index / steps);
	const points = [...frames].sort((a, b) => a - b).map(frame => (
		`${((frame - start) * scale).toFixed(3)},${((1 - clipFadeGain(frame, duration, fadeIn, fadeOut)) * 50).toFixed(3)}`
	)).join(' ');
	return {
		left: (clip.timelineStartFrame + start - viewportStart) * scale,
		width,
		fadeInX: handleX(fadeIn),
		fadeOutX: handleX(duration - fadeOut),
		points,
	};
}
