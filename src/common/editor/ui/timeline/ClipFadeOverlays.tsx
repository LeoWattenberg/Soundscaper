/* SPDX-License-Identifier: AGPL-3.0-only */
import { useLayoutEffect, useMemo, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { TrackFadeHandle } from '@soundscaper/design-system/Track/TrackFadeHandle';
import { fadeDurationAtKey, fadeField, fadeOverlayGeometry } from './clip-fade-geometry.ts';
import type { ClipFadeEdge, FadeClip } from './clip-fade-geometry.ts';

interface OverlayClip extends FadeClip {
	readonly id: string;
	readonly kind?: string;
	readonly isRecordingPreview?: boolean;
	readonly title?: string;
	readonly sourceId?: string;
}

interface Props {
	readonly rootRef: RefObject<HTMLDivElement | null>;
	readonly clips: readonly OverlayClip[];
	readonly channelCounts: ReadonlyMap<string, number>;
	readonly channelHeightRatio: number;
	readonly displayMode: string;
	readonly selectedIds: ReadonlySet<string>;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly pixelsPerSecond: number;
	readonly sampleRate: number;
	readonly blocked: boolean;
	readonly copy: { readonly fadeIn: string; readonly fadeOut: string };
	readonly onChange: (id: string, changes: { fadeInFrames?: number; fadeOutFrames?: number }) => void;
	readonly onTabOut: (id: string) => void;
}

export function ClipFadeOverlays({ rootRef, clips, channelCounts, channelHeightRatio, displayMode, selectedIds, startFrame, endFrame, pixelsPerSecond, sampleRate, blocked, copy, onChange, onTabOut }: Props) {
	const [targets, setTargets] = useState<ReadonlyMap<string, HTMLElement>>(new Map());
	const geometries = useMemo(() => new Map(clips.map(clip => [
		clip.id, fadeOverlayGeometry(clip, startFrame, endFrame, pixelsPerSecond, sampleRate),
	])), [clips, startFrame, endFrame, pixelsPerSecond, sampleRate]);
	useLayoutEffect(() => {
		const next = new Map<string, HTMLElement>();
		for (const element of rootRef.current?.querySelectorAll<HTMLElement>('[data-clip-id]') ?? []) {
			if (element.dataset.clipId) next.set(element.dataset.clipId, element);
		}
		setTargets(current => current.size === next.size && [...next].every(([id, element]) => current.get(id) === element) ? current : next);
	}, [clips, rootRef]);
	return clips.filter(clip => !clip.isRecordingPreview && clip.kind === 'audio').map(clip => {
		const target = targets.get(clip.id);
		if (!target) return null;
		const geometry = geometries.get(clip.id);
		if (!geometry || geometry.width <= 0) return null;
		const hasFade = (clip.fadeInFrames ?? 0) > 0 || (clip.fadeOutFrames ?? 0) > 0;
		const selected = selectedIds.has(clip.id);
		if (!hasFade && !selected) return null;
		const stereo = channelCounts.get(clip.id) === 2;
		const shadePolygon = `0,0 ${geometry.width},0 ${geometry.points.split(' ').reverse().join(' ')}`;
		const shadeShape = (transform?: string) => <g transform={transform}>
			<polygon points={shadePolygon} />
			<polyline points={geometry.points} vectorEffect="non-scaling-stroke" />
		</g>;
		const displayWidth = Math.max(48, Math.round(geometry.width));
		const displayX = (x: number): number => x / geometry.width * displayWidth;
		const inBoundaryX = displayX(geometry.fadeInX ?? 0);
		const outBoundaryX = displayX(geometry.fadeOutX ?? geometry.width);
		return createPortal(<div className="audio-editor-clip-fade">
			{hasFade && <svg className="audio-editor-clip-fade__shade" viewBox={`0 0 ${geometry.width} 100`}
				preserveAspectRatio="none" aria-hidden="true">
				{stereo ? (displayMode === 'multiview' ? [0, 50] : [0]).map(paneTop => (
					<g key={paneTop} transform={displayMode === 'multiview' ? `translate(0 ${paneTop}) scale(1 0.5)` : undefined}>
						{shadeShape(`scale(1 ${channelHeightRatio})`)}
						{shadeShape(`translate(0 100) scale(1 -${1 - channelHeightRatio})`)}
					</g>
				)) : shadeShape()}
			</svg>}
			{selected && (['in', 'out'] as const).map((edge: ClipFadeEdge) => {
				const x = edge === 'in' ? geometry.fadeInX : geometry.fadeOutX;
				if (x === null) return null;
				const field = fadeField(edge);
				const value = clip[field] ?? 0;
				const label = edge === 'in' ? copy.fadeIn : copy.fadeOut;
				return <TrackFadeHandle key={edge} edge={edge} boundaryX={displayX(x)}
					oppositeBoundaryX={edge === 'in' ? outBoundaryX : inBoundaryX} clipWidth={displayWidth}
					role="slider" tabIndex={-1}
					data-clip-fade-handle={edge} aria-label={label} title={label}
					aria-valuemin={0} aria-valuemax={clip.durationFrames / sampleRate} aria-valuenow={value / sampleRate}
					aria-orientation="horizontal" disabled={blocked}
					onClick={event => { event.stopPropagation(); }}
					onDoubleClick={event => { event.stopPropagation(); }}
					onKeyDown={event => {
						event.stopPropagation();
						if (event.key === 'Tab') {
							event.preventDefault();
							const nextEdge = edge === 'in' && !event.shiftKey ? 'out' : edge === 'out' && event.shiftKey ? 'in' : null;
							const next = nextEdge ? target.querySelector<HTMLButtonElement>(`[data-clip-fade-handle="${nextEdge}"]`) : null;
							if (next) next.focus();
							else if (event.shiftKey) target.focus();
							else onTabOut(clip.id);
							return;
						}
						if (event.ctrlKey || event.metaKey || event.altKey) return;
						const next = fadeDurationAtKey(event.key, event.shiftKey, value, sampleRate, clip.durationFrames);
						if (next === null) return;
						event.preventDefault();
						if (next !== value) onChange(clip.id, { [field]: next });
					}} />;
			})}
		</div>, target, clip.id);
	});
}
