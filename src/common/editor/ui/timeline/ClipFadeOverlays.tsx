/* SPDX-License-Identifier: AGPL-3.0-only */
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { TrackFadeHandle } from '@soundscaper/design-system/Track/TrackFadeHandle';
import { TrackFadeShapeHandle } from '@soundscaper/design-system/Track/TrackFadeShapeHandle';
import { fadeField, fadeShapeAtKey, fadeShapeField, placeFadeShapeHandles } from './clip-fade-geometry.ts';
import type { ClipFadeEdge, FadeClip } from './clip-fade-geometry.ts';
import { ClipFadeMenu } from './ClipFadeMenu.tsx';
import { isFadeShapeMenuKey, keyboardFadeShapeMenuPosition } from './FadeShapeMenu.tsx';
import type { FadeShapeMenuCopy, FadeShapeMenuPosition } from './FadeShapeMenu.tsx';
import { createClipFadeGeometryReader } from './clip-overlay-presentation.ts';
import { routeClipHandleKeyboard } from './clip-handle-keyboard.ts';

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
	readonly onChange: (id: string, changes: ClipFadeChanges, editedEdge?: ClipFadeEdge) => void;
	readonly onEditFades?: (id: string) => void;
	readonly onTabOut: (id: string) => void;
}


export function ClipFadeOverlays({ rootRef, clips, selectedIds, startFrame, endFrame, pixelsPerSecond, sampleRate, blocked, handleTabIndex = -1, showFadeShapeHandles, crossfadedFadeEdges, copy, onChange, onTabOut, onEditFades = () => undefined }: Props) {
	const [targets, setTargets] = useState<ReadonlyMap<string, HTMLElement>>(new Map());
	const [menu, setMenu] = useState<(FadeShapeMenuPosition & { readonly clipId: string; readonly edge: ClipFadeEdge }) | null>(null);
	const close = useCallback(() => setMenu(null), []);
	const menuClip = menu && clips.find(clip => clip.id === menu.clipId);
	const handleKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
		const id = event.currentTarget.closest<HTMLElement>('[data-clip-id]')?.dataset.clipId;
		// Source monitor's handles belong to its waveform, outside timeline navigation.
		if (event.key === 'Tab' && handleTabIndex === 0 && id) {
			event.preventDefault(); event.stopPropagation(); onTabOut(id); return true;
		}
		const handled = routeClipHandleKeyboard(event, {
			clips, sampleRate, blocked, selectedIds: [...selectedIds], playheadFrame: 0, updateFade: onChange,
			trim() {}, stretch() {}, trimToFrame() {}, stretchToFrame() {}, seek() {}, openFades: onEditFades,
		});
		if (handled && event.key === 'Tab' && id) onTabOut(id);
		return handled;
	};
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
		const displayWidth = Math.round(geometry.width);
		const displayX = (x: number): number => x / geometry.width * displayWidth;
		const inBoundaryX = displayX(geometry.fadeInX ?? 0);
		const outBoundaryX = displayX(geometry.fadeOutX ?? geometry.width);
		const shapePositions = showFadeShapeHandles ? placeFadeShapeHandles({
			...geometry,
			curves,
		}, displayWidth, clip) : [];
		return createPortal(<div className="audio-editor-clip-fade" data-fade-pointer={displayWidth >= 64 ? "true" : "false"}>
			{hasFade && <svg className="audio-editor-clip-fade__curve" viewBox={`0 0 ${geometry.width} 100`}
				preserveAspectRatio="none" aria-hidden="true">
				<path data-fade-shading d={curves.map(curve => curve.shadePath).join(' ')}
					fill="rgba(0, 0, 0, 0.18)" stroke="none" />
				{curves.map(curve => {
					const x = curve.edge === 'in' ? geometry.fadeInX : geometry.fadeOutX;
					return x === null ? null : <line key={curve.edge} data-fade-boundary={curve.edge}
						x1={x} x2={x} y1={0} y2={100} stroke="rgba(0, 0, 0, 0.45)"
						strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />;
				})}
				{curves.map(curve => <path key={curve.edge} data-fade-curve={curve.edge}
					d={curve.path} fill="none" stroke="rgba(0, 0, 0, 0.45)" strokeWidth={1.5}
					vectorEffect="non-scaling-stroke" />)}
			</svg>}
			{(['in', 'out'] as const).map((edge: ClipFadeEdge) => {
				if (crossfadedFadeEdges.has(`${clip.id}:${edge}`)) return null;
				const x = edge === 'in' ? geometry.fadeInX : geometry.fadeOutX;
				if (x === null) return null;
				const field = fadeField(edge);
				const value = clip[field] ?? 0;
				const label = edge === 'in' ? copy.fadeIn : copy.fadeOut;
				return <TrackFadeHandle keyboardReachable key={edge} edge={edge} boundaryX={displayX(x)}
					oppositeBoundaryX={edge === 'in' ? outBoundaryX : inBoundaryX} clipWidth={displayWidth}
					role="slider" tabIndex={handleTabIndex}
					data-clip-fade-handle={edge} aria-label={label}
					aria-valuemin={0} aria-valuemax={clip.durationFrames / sampleRate} aria-valuenow={value / sampleRate}
					aria-orientation="horizontal" disabled={blocked}
					onContextMenu={event => {
						event.preventDefault(); event.stopPropagation();
						if (!blocked) setMenu({ target: event.currentTarget, x: event.clientX, y: event.clientY, clipId: clip.id, edge });
					}}
					onClick={event => { event.stopPropagation(); }}
					onDoubleClick={event => { event.stopPropagation(); if (!blocked && !event.ctrlKey && !event.metaKey) onChange(clip.id, { [fadeShapeField(edge)]: 2 }); }}
					onKeyDown={event => {
						if (event.ctrlKey || event.metaKey || event.altKey) return;
						if (isFadeShapeMenuKey(event) && !blocked) { event.preventDefault(); event.stopPropagation(); setMenu({ ...keyboardFadeShapeMenuPosition(event.currentTarget), clipId: clip.id, edge }); return; }
						if (handleKeyboard(event) || blocked) return;
						const next = event.key === 'Home' ? 0 : event.key === 'End' ? clip.durationFrames : null;
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
					onClick={event => { event.stopPropagation(); if (!blocked && (event.ctrlKey || event.metaKey)) onChange(clip.id, { [field]: clip[field] === undefined ? 2 : undefined }); }}
					onDoubleClick={event => { event.stopPropagation(); if (!blocked && !event.ctrlKey && !event.metaKey) onChange(clip.id, { [field]: 2 }); }}
					onKeyDown={event => {
						if (event.ctrlKey || event.metaKey || event.altKey) return;
						if (isFadeShapeMenuKey(event) && !blocked) {
							event.stopPropagation();
							event.preventDefault();
							setMenu({ ...keyboardFadeShapeMenuPosition(event.currentTarget), clipId: clip.id, edge: position.edge });
							return;
						}
						if (handleKeyboard(event) || blocked) return;
						const next = event.key === 'Home' || event.key === 'End' ? fadeShapeAtKey(event.key, event.shiftKey, value) : null;
						if (next === null) return;
						event.stopPropagation();
						event.preventDefault();
						if (next !== value) onChange(clip.id, { [field]: next });
					}} />;
			})}
		</div>, target, clip.id);
	})}
		{menu && menuClip && !blocked && !crossfadedFadeEdges.has(`${menu.clipId}:${menu.edge}`) && <ClipFadeMenu
			position={menu} edge={menu.edge} hasFade={(menuClip[fadeField(menu.edge)] ?? 0) > 0}
			copy={copy as unknown as Readonly<Record<string, string>>} onClose={close}
			onEdit={() => onEditFades(menu.clipId)} onRemove={() => onChange(menu.clipId, { [fadeField(menu.edge)]: 0 })} />}
	</>;
}
