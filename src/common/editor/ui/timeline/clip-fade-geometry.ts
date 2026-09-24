/* SPDX-License-Identifier: AGPL-3.0-only */

import { fadeEnvelope as clipFadeGain } from '../../design-system-adapters/validation.ts';
import { evaluateClipFadeAt } from '../../audio-clip-transition-gain.ts';
export { clipFadeGain };

export type ClipFadeEdge = 'in' | 'out';
const MIDPOINT_BASE_GAIN = Math.cos(Math.PI / 4);
export const MINIMUM_FADE_SHAPE = 0.15;
export const MAXIMUM_FADE_SHAPE = 6;
export interface FadeClip {
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
	readonly fadeInShape?: number;
	readonly fadeOutShape?: number;
}

export interface FadeCurveGeometry {
	readonly edge: ClipFadeEdge;
	readonly path: string;
	readonly midpointX: number | null;
	readonly midpointGain: number;
	readonly fadeStartX: number;
	readonly fadeEndX: number;
}

export interface FadeShapeHandlePosition {
	readonly edge: ClipFadeEdge;
	readonly left: number;
	readonly topPercent: number;
	readonly baseGain: number;
	readonly gain: number;
}

export interface FadeOverlayGeometry {
	readonly left: number;
	readonly width: number;
	readonly fadeInX: number | null;
	readonly fadeOutX: number | null;
	readonly curves: readonly FadeCurveGeometry[];
}

export function fadeField(edge: ClipFadeEdge): 'fadeInFrames' | 'fadeOutFrames' {
	return edge === 'in' ? 'fadeInFrames' : 'fadeOutFrames';
}

export function fadeShapeField(edge: ClipFadeEdge): 'fadeInShape' | 'fadeOutShape' {
	return edge === 'in' ? 'fadeInShape' : 'fadeOutShape';
}

export function fadeShapeAtPointer(initial: number, startY: number, clientY: number, gainHeight: number, baseGain = MIDPOINT_BASE_GAIN, startGain = baseGain ** initial): number {
	if (clientY === startY) return initial;
	const gain = Math.max(0.05, Math.min(0.95, startGain - (clientY - startY) / Math.max(1, gainHeight)));
	const invertibleBase = Math.max(0.000001, Math.min(0.999999, baseGain));
	return Math.max(MINIMUM_FADE_SHAPE, Math.min(MAXIMUM_FADE_SHAPE, Math.log(gain) / Math.log(invertibleBase)));
}

export function fadeShapeAtKey(key: string, shift: boolean, current: number): number | null {
	if (key === 'Home') return MINIMUM_FADE_SHAPE;
	if (key === 'End') return MAXIMUM_FADE_SHAPE;
	const direction = key === 'ArrowDown' || key === 'ArrowRight' ? 1
		: key === 'ArrowUp' || key === 'ArrowLeft' ? -1 : 0;
	if (!direction) return null;
	const step = shift ? 0.01 : 0.1;
	return Math.max(MINIMUM_FADE_SHAPE, Math.min(MAXIMUM_FADE_SHAPE, Math.round((current + direction * step) * 100) / 100));
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
): FadeOverlayGeometry {
	const duration = clip.durationFrames;
	const start = Math.max(0, viewportStart - clip.timelineStartFrame);
	const end = Math.min(duration, viewportEnd - clip.timelineStartFrame);
	const scale = pixelsPerSecond / sampleRate;
	const width = Math.max(0, (end - start) * scale);
	const fadeIn = Math.min(duration, clip.fadeInFrames ?? 0);
	const fadeOut = Math.min(duration, clip.fadeOutFrames ?? 0);
	const handleX = (frame: number): number | null => frame < start || frame > end ? null : (frame - start) * scale;
	const curves: FadeCurveGeometry[] = [];
	for (const edge of ['in', 'out'] as const) {
		const fadeFrames = edge === 'in' ? fadeIn : fadeOut;
		if (fadeFrames <= 0) continue;
		const fadeStart = edge === 'in' ? 0 : duration - fadeFrames;
		const fadeEnd = edge === 'in' ? fadeFrames : duration;
		const visibleStart = Math.max(start, fadeStart);
		const visibleEnd = Math.min(end, fadeEnd);
		if (visibleEnd <= visibleStart) continue;
		const shape = clip[fadeShapeField(edge)];
		// Match the design system's 64 segments, clipped to the rendered viewport.
		const points: string[] = [];
		for (let index = 0; index <= 64; index += 1) {
			const frame = visibleStart + (visibleEnd - visibleStart) * index / 64;
			const gain = evaluateClipFadeAt(frame, duration, fadeFrames, edge, shape);
			points.push(`${((frame - start) * scale).toFixed(3)},${((1 - gain) * 100).toFixed(3)}`);
		}
		const midpoint = (fadeStart + fadeEnd) / 2;
		curves.push({
			edge,
			path: `M ${points.join(' L ')}`,
			midpointX: handleX(midpoint),
			midpointGain: evaluateClipFadeAt(midpoint, duration, fadeFrames, edge, shape),
			fadeStartX: (fadeStart - start) * scale,
			fadeEndX: (fadeEnd - start) * scale,
		});
	}
	return {
		left: (clip.timelineStartFrame + start - viewportStart) * scale,
		width,
		fadeInX: handleX(fadeIn),
		fadeOutX: handleX(duration - fadeOut),
		curves,
	};
}

/** Place both 16px dots on their curves, separating their hit targets if fades overlap. */
export function placeFadeShapeHandles(
	geometry: FadeOverlayGeometry, displayWidth: number, clip: FadeClip,
): readonly FadeShapeHandlePosition[] {
	const available = geometry.curves.filter(curve => curve.midpointX !== null);
	const lefts = new Map(available.map(curve => [
		curve.edge,
		curve.midpointX! / geometry.width * displayWidth - 8,
	]));
	const incoming = lefts.get('in');
	const outgoing = lefts.get('out');
	if (incoming !== undefined && outgoing !== undefined && outgoing - incoming < 16) {
		const left = Math.max(0, Math.min(displayWidth - 32,
			Math.round((incoming + outgoing - 16) / 2)));
		lefts.set('in', left);
		lefts.set('out', left + 16);
	}
	return available.map(curve => {
		const left = lefts.get(curve.edge)!;
		const x = (left + 8) / displayWidth * geometry.width;
		const fadeWidth = curve.fadeEndX - curve.fadeStartX;
		const progress = Math.max(0, Math.min(1, curve.edge === 'in'
			? (x - curve.fadeStartX) / fadeWidth
			: (curve.fadeEndX - x) / fadeWidth));
		const baseGain = Math.sin(progress * Math.PI / 2);
		const shape = clip[fadeShapeField(curve.edge)];
		const gain = shape === undefined ? progress : baseGain ** shape;
		return { edge: curve.edge, left, topPercent: (1 - gain) * 100, baseGain, gain };
	});
}
