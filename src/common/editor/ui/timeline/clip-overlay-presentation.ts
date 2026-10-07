/* SPDX-License-Identifier: AGPL-3.0-only */

import { fadeOverlayGeometry, type FadeClip, type FadeOverlayGeometry } from './clip-fade-geometry.ts';

interface Clip extends FadeClip { readonly id: string; readonly kind?: string; readonly isRecordingPreview?: boolean; }

/** Callers provide the same immutable clip snapshot used by the row's projection. */
export function createClipFadeGeometryReader() {
	let previousClips: readonly Clip[] | null = null;
	let previousWindow = '';
	let geometries = new WeakMap<Clip, FadeOverlayGeometry>();
	return <T extends Clip>(clips: readonly T[], selectedIds: ReadonlySet<string>, startFrame: number, endFrame: number,
		pixelsPerSecond: number, sampleRate: number): ReadonlyMap<string, { readonly clip: T; readonly geometry: FadeOverlayGeometry }> => {
		const window = `${startFrame}:${endFrame}:${pixelsPerSecond}:${sampleRate}`;
		if (previousClips !== clips || previousWindow !== window) { geometries = new WeakMap(); previousClips = clips; previousWindow = window; }
		const visible = new Map<string, { clip: T; geometry: FadeOverlayGeometry }>();
		for (const clip of clips) {
			if (clip.isRecordingPreview || clip.kind !== 'audio' || !selectedIds.has(clip.id) && !((clip.fadeInFrames ?? 0) > 0) && !((clip.fadeOutFrames ?? 0) > 0)) continue;
			let geometry = geometries.get(clip);
			if (!geometry) { geometry = fadeOverlayGeometry(clip, startFrame, endFrame, pixelsPerSecond, sampleRate); geometries.set(clip, geometry); }
			if (geometry.width > 0) visible.set(clip.id, { clip, geometry });
		}
		return visible;
	};
}

export function applyLoopTrimStyle(trim: HTMLElement, hasRepeats: boolean, firstEnd: number, startFrame: number, visibleEnd: number,
	pixelsPerSecond: number, sampleRate: number): void {
	const right = hasRepeats ? `${Math.max(0, visibleEnd - firstEnd) * pixelsPerSecond / sampleRate}px` : '';
	const visibility = hasRepeats && (firstEnd < startFrame || firstEnd > visibleEnd) ? 'hidden' : '';
	if (trim.style.right !== right) trim.style.right = right;
	if (trim.style.visibility !== visibility) trim.style.visibility = visibility;
}
