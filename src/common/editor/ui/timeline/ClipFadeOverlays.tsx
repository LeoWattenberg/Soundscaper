/* SPDX-License-Identifier: AGPL-3.0-only */
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { TrackFadeHandle } from '@soundscaper/design-system/Track/TrackFadeHandle';
import { TrackFadeShapeHandle } from '@soundscaper/design-system/Track/TrackFadeShapeHandle';
import { fadeDurationAtKey, fadeField, fadeShapeAtKey, fadeShapeField, placeFadeShapeHandles } from './clip-fade-geometry.ts';
import type { ClipFadeEdge, FadeClip } from './clip-fade-geometry.ts';
import { END_FADE_SHAPE_PRESETS, selectedEndFadeShapePreset } from '../../clip-fade-presets.ts';
import { FadeShapeMenu, isFadeShapeMenuKey, keyboardFadeShapeMenuPosition } from './FadeShapeMenu.tsx';
import type { FadeShapeMenuCopy, FadeShapeMenuPosition } from './FadeShapeMenu.tsx';
import { createClipFadeGeometryReader } from './clip-overlay-presentation.ts';

export type ClipFadeChanges = Readonly<{
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
	readonly fadeInShape?: number | undefined;
	readonly fadeOutShape?: number | undefined;
}>;

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
	readonly selectedIds: ReadonlySet<string>;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly pixelsPerSecond: number;
	readonly sampleRate: number;
	readonly blocked: boolean;
	readonly handleTabIndex?: 0 | -1;
	readonly showFadeShapeHandles: boolean;
	readonly crossfadedFadeEdges: ReadonlySet<string>;
	readonly copy: FadeShapeMenuCopy & { readonly fadeIn: string; readonly fadeOut: string; readonly fadeInShape: string; readonly fadeOutShape: string; readonly legacyLinearFadeShape: string };
	readonly onChange: (id: string, changes: ClipFadeChanges) => void;
	readonly onTabOut: (id: string) => void;
}

function moveFadeFocus(target: HTMLElement, current: HTMLElement, backwards: boolean, clipId: string, onTabOut: (id: string) => void): void {
	const controls = [
		target.querySelector<HTMLButtonElement>('[data-clip-fade-handle="in"]'),
		target.querySelector<HTMLButtonElement>('[data-clip-fade-shape-handle="in"]'),
		target.querySelector<HTMLButtonElement>('[data-clip-fade-handle="out"]'),
		target.querySelector<HTMLButtonElement>('[data-clip-fade-shape-handle="out"]'),
	].filter((control): control is HTMLButtonElement => control !== null && !control.disabled);
	const index = controls.indexOf(current as HTMLButtonElement);
	const next = controls[index + (backwards ? -1 : 1)];
	if (next) next.focus();
	else if (backwards) target.focus();
	else onTabOut(clipId);
}

export function ClipFadeOverlays({ rootRef, clips, selectedIds, startFrame, endFrame, pixelsPerSecond, sampleRate, blocked, handleTabIndex = -1, showFadeShapeHandles, crossfadedFadeEdges, copy, onChange, onTabOut }: Props) {
	const [targets, setTargets] = useState<ReadonlyMap<string, HTMLElement>>(new Map());
	const [menu, setMenu] = useState<(FadeShapeMenuPosition & { readonly clipId: string; readonly edge: ClipFadeEdge }) | null>(null);
	const close = useCallback(() => setMenu(null), []);
	const menuClip = menu && clips.find(clip => clip.id === menu.clipId);
	const readGeometries = useMemo(createClipFadeGeometryReader, []);
	const geometries = useMemo(() => readGeometries(clips, selectedIds, startFrame, endFrame, pixelsPerSecond, sampleRate),
		[readGeometries, clips, selectedIds, startFrame, endFrame, pixelsPerSecond, sampleRate]);
	useLayoutEffect(() => {
		const next = new Map<string, HTMLElement>();
		for (const element of geometries.size ? rootRef.current?.querySelectorAll<HTMLElement>('[data-clip-id]') ?? [] : []) {
			if (element.dataset.clipId && geometries.has(element.dataset.clipId)) next.set(element.dataset.clipId, element);
		}
		setTargets(current => current.size === next.size && [...next].every(([id, element]) => current.get(id) === element) ? current : next);
	}, [geometries, rootRef]);
	return <>{[...geometries.values()].map(({ clip, geometry }) => {
		const target = targets.get(clip.id);
		if (!target) return null;
		const curves = geometry.curves.filter(curve => !crossfadedFadeEdges.has(`${clip.id}:${curve.edge}`));
		const hasFade = curves.length > 0;
		const selected = selectedIds.has(clip.id);
		if (!hasFade && !selected) return null;
		const displayWidth = Math.round(geometry.width);
		const displayX = (x: number): number => x / geometry.width * displayWidth;
		const inBoundaryX = displayX(geometry.fadeInX ?? 0);
		const outBoundaryX = displayX(geometry.fadeOutX ?? geometry.width);
		const shapePositions = selected && showFadeShapeHandles ? placeFadeShapeHandles({
			...geometry,
			curves,
		}, displayWidth, clip) : [];
		return createPortal(<div className="audio-editor-clip-fade">
			{hasFade && <svg className="audio-editor-clip-fade__curve" viewBox={`0 0 ${geometry.width} 100`}
				preserveAspectRatio="none" aria-hidden="true">
				<path data-fade-shading d={curves.map(curve => curve.shadePath).join(' ')}
					fill="rgba(0, 0, 0, 0.18)" stroke="none" />
				{selected && curves.map(curve => {
					const x = curve.edge === 'in' ? geometry.fadeInX : geometry.fadeOutX;
					return x === null ? null : <line key={curve.edge} data-fade-boundary={curve.edge}
						x1={x} x2={x} y1={0} y2={100} stroke="rgba(0, 0, 0, 0.55)"
						strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />;
				})}
				{curves.map(curve => <path key={curve.edge} data-fade-curve={curve.edge}
					d={curve.path} fill="none" stroke="rgba(0, 0, 0, 0.55)" strokeWidth={1.5}
					vectorEffect="non-scaling-stroke" />)}
			</svg>}
			{selected && (['in', 'out'] as const).map((edge: ClipFadeEdge) => {
				if (crossfadedFadeEdges.has(`${clip.id}:${edge}`)) return null;
				const x = edge === 'in' ? geometry.fadeInX : geometry.fadeOutX;
				if (x === null) return null;
				const field = fadeField(edge);
				const value = clip[field] ?? 0;
				const label = edge === 'in' ? copy.fadeIn : copy.fadeOut;
				return <TrackFadeHandle key={edge} edge={edge} boundaryX={displayX(x)}
					oppositeBoundaryX={edge === 'in' ? outBoundaryX : inBoundaryX} clipWidth={displayWidth}
					role="slider" tabIndex={handleTabIndex}
					data-clip-fade-handle={edge} aria-label={label}
					aria-valuemin={0} aria-valuemax={clip.durationFrames / sampleRate} aria-valuenow={value / sampleRate}
					aria-orientation="horizontal" disabled={blocked}
					onClick={event => { event.stopPropagation(); }}
					onDoubleClick={event => { event.stopPropagation(); }}
					onKeyDown={event => {
						if (event.ctrlKey || event.metaKey || event.altKey) return;
						if (event.key === 'Tab' && handleTabIndex < 0) {
							event.stopPropagation();
							event.preventDefault();
							moveFadeFocus(target, event.currentTarget, event.shiftKey, clip.id, onTabOut);
							return;
						}
						const next = fadeDurationAtKey(event.key, event.shiftKey, value, sampleRate, clip.durationFrames);
						if (next === null) return;
						event.stopPropagation();
						event.preventDefault();
						if (next !== value) onChange(clip.id, { [field]: next });
					}} />;
			})}
			{shapePositions.map(position => {
				const field = fadeShapeField(position.edge);
				const value = clip[field] ?? 2;
				return <TrackFadeShapeHandle key={position.edge} edge={position.edge}
					left={position.left}
					top={`clamp(0px, calc(${position.topPercent.toFixed(3)}% - 8px), calc(100% - 16px))`}
					tabIndex={handleTabIndex} data-clip-fade-shape-handle={position.edge}
					data-fade-shape-base-gain={position.baseGain}
					data-fade-shape-start-gain={position.gain}
					aria-label={position.edge === 'in' ? copy.fadeInShape : copy.fadeOutShape}
					aria-valuemin={0.15} aria-valuemax={6} aria-valuenow={value}
					aria-valuetext={clip[field] === undefined ? copy.fadeShapeLinear || copy.legacyLinearFadeShape : undefined}
					aria-orientation="vertical" disabled={blocked}
					aria-haspopup="menu" aria-expanded={menu?.clipId === clip.id && menu.edge === position.edge}
					onContextMenu={event => {
						event.preventDefault();
						event.stopPropagation();
						if (blocked) return;
						event.currentTarget.focus({ preventScroll: true });
						setMenu({ target: event.currentTarget, x: event.clientX, y: event.clientY, clipId: clip.id, edge: position.edge });
					}}
					onClick={event => { event.stopPropagation(); }}
					onDoubleClick={event => { event.stopPropagation(); }}
					onKeyDown={event => {
						if (event.ctrlKey || event.metaKey || event.altKey) return;
						if (isFadeShapeMenuKey(event) && !blocked) {
							event.stopPropagation();
							event.preventDefault();
							setMenu({ ...keyboardFadeShapeMenuPosition(event.currentTarget), clipId: clip.id, edge: position.edge });
							return;
						}
						if (event.key === 'Tab' && handleTabIndex < 0) {
							event.stopPropagation();
							event.preventDefault();
							moveFadeFocus(target, event.currentTarget, event.shiftKey, clip.id, onTabOut);
							return;
						}
						const next = fadeShapeAtKey(event.key, event.shiftKey, value);
						if (next === null) return;
						event.stopPropagation();
						event.preventDefault();
						if (next !== value) onChange(clip.id, { [field]: next });
					}} />;
			})}
		</div>, target, clip.id);
	})}
		{menu && menuClip && !blocked && showFadeShapeHandles && selectedIds.has(menu.clipId)
			&& !crossfadedFadeEdges.has(`${menu.clipId}:${menu.edge}`) && <FadeShapeMenu
				position={menu} presets={END_FADE_SHAPE_PRESETS} copy={copy}
				selectedId={selectedEndFadeShapePreset(menuClip[fadeShapeField(menu.edge)])}
				onClose={close} onSelect={preset => {
					const field = fadeShapeField(menu.edge);
					if (selectedEndFadeShapePreset(menuClip[field]) !== preset.id) onChange(menu.clipId, { [field]: preset.shape });
				}} />}
	</>;
}
