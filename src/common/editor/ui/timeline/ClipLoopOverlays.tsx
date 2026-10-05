/* SPDX-License-Identifier: AGPL-3.0-only */
import { useLayoutEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { clipLoopBoundaries, readClipLoop, type LoopAudioClip } from '../../audio-clip-loop.ts';
import { TIMELINE_ADDITIONAL_COPY } from '../../../i18n/editor-timeline-additional-copy.ts';
import './clip-loop.css';

interface Props {
	readonly rootRef: RefObject<HTMLDivElement | null>;
	readonly clips: readonly (LoopAudioClip & { readonly id: string; readonly timelineStartFrame: number })[];
	readonly startFrame: number;
	readonly endFrame: number;
	readonly pixelsPerSecond: number;
	readonly sampleRate: number;
	readonly blocked: boolean;
	readonly selectedIds: ReadonlySet<string>;
	readonly copy: Readonly<Record<string, string>>;
	readonly onChange: (id: string, changes: { loop: { periodFrames: number; durationFrames: number } }) => void;
}

export function ClipLoopOverlays({ rootRef, clips, startFrame, endFrame, pixelsPerSecond, sampleRate, blocked, selectedIds, copy, onChange }: Props) {
	const handleLabel = copy['ui.timeline.loopClipLength'] || TIMELINE_ADDITIONAL_COPY.loopClipLength;
	const [targets, setTargets] = useState<ReadonlyMap<string, HTMLElement>>(new Map());
	useLayoutEffect(() => {
		const next = new Map<string, HTMLElement>();
		for (const target of rootRef.current?.querySelectorAll<HTMLElement>('[data-clip-id]') ?? []) {
			const clip = clips.find(item => item.id === target.dataset.clipId);
			const loop = clip ? readClipLoop(clip) : null;
			const trim = target.querySelector<HTMLElement>('.clip-display__handle--trim-right');
			if (trim && clip) {
				const firstEnd = clip.timelineStartFrame + (loop?.periodFrames ?? clip.durationFrames) - (loop?.offsetFrames ?? 0);
				trim.style.right = loop ? `${Math.max(0, Math.min(clip.timelineStartFrame + clip.durationFrames, endFrame) - firstEnd) * pixelsPerSecond / sampleRate}px` : '';
				trim.style.visibility = loop && (firstEnd < startFrame || firstEnd > endFrame) ? 'hidden' : '';
			}
			if (clip && loop) next.set(clip.id, target);
		}
		setTargets(current => current.size === next.size && [...next].every(([id, target]) => current.get(id) === target) ? current : next);
	}, [clips, rootRef, startFrame, endFrame, pixelsPerSecond, sampleRate, selectedIds]);
	return clips.map(clip => {
		const target = targets.get(clip.id);
		const loop = readClipLoop(clip);
		if (!target || !loop) return null;
		const visibleStart = Math.max(startFrame, clip.timelineStartFrame);
		const boundaries = clipLoopBoundaries(clip, startFrame, endFrame, sampleRate / pixelsPerSecond * 2);
		return createPortal(<>
			{boundaries.map(frame => <span key={frame} className="audio-editor-clip-loop-boundary" data-loop-boundary-frame={frame}
				aria-hidden="true" style={{ left: (frame - visibleStart) * pixelsPerSecond / sampleRate }} />)}
			{selectedIds.has(clip.id) && clip.timelineStartFrame + clip.durationFrames <= endFrame && <button type="button"
				className="clip-display__handle clip-display__handle--loop-right" disabled={blocked}
				aria-label={handleLabel} title={handleLabel} aria-valuenow={clip.durationFrames / sampleRate}
				role="slider" aria-valuemin={1 / sampleRate} aria-valuemax={Number.MAX_SAFE_INTEGER / sampleRate}
				onClick={event => { event.stopPropagation(); }} onDoubleClick={event => { event.stopPropagation(); }}
				onKeyDown={event => {
					event.stopPropagation();
					if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
					event.preventDefault();
					const delta = (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? Math.max(1, Math.round(sampleRate / 100)) : loop.periodFrames);
					onChange(clip.id, { loop: { periodFrames: loop.periodFrames, durationFrames: Math.max(1, clip.durationFrames + delta) } });
				}}>
				<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5h9l-2-2m2 2-2 2M13 11H4l2 2m-2-2 2-2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
			</button>}
		</>, target, `loop-${clip.id}`);
	});
}
