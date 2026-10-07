/* SPDX-License-Identifier: AGPL-3.0-only */
import { useLayoutEffect, useMemo, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@soundscaper/design-system/Icon';
import { clipCanLoop, clipHasLoopRepeats, clipLoopBoundaries, normalizeInactiveClipLoop, readClipLoop, type LoopAudioClip } from '../../audio-clip-loop.ts';
import { TIMELINE_ADDITIONAL_COPY } from '../../../i18n/editor-timeline-additional-copy.ts';
import './clip-loop.css';
import { applyLoopTrimStyle } from './clip-overlay-presentation.ts';

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
	readonly onChange: (id: string, changes: { loop: {
		periodFrames: number; durationFrames: number; offsetFrames?: number; sourceStartFrame?: number; sourceDurationFrames?: number;
	} }) => void;
}

export function ClipLoopOverlays({ rootRef, clips, startFrame, endFrame, pixelsPerSecond, sampleRate, blocked, selectedIds, copy, onChange }: Props) {
	const handleLabel = copy['ui.timeline.loopClipLength'] || TIMELINE_ADDITIONAL_COPY.loopClipLength;
	const [targets, setTargets] = useState<ReadonlyMap<string, HTMLElement>>(new Map());
	const clipById = useMemo(() => new Map(clips.map(clip => [clip.id, clip])), [clips]);
	const presentations = useMemo(() => clips.flatMap(clip => {
		if (!clipCanLoop(clip)) return [];
		const normalized = normalizeInactiveClipLoop(clip);
		return [{ clip, normalized, loop: readClipLoop(normalized) ?? { periodFrames: normalized.durationFrames, offsetFrames: 0 },
			visibleStart: Math.max(startFrame, clip.timelineStartFrame), boundaries: clipLoopBoundaries(clip, startFrame, endFrame, sampleRate / pixelsPerSecond * 2) }];
	}), [clips, startFrame, endFrame, pixelsPerSecond, sampleRate]);
	useLayoutEffect(() => {
		let active = true;
		const refresh = () => {
			if (!active) return;
			const next = new Map<string, HTMLElement>();
			for (const target of rootRef.current?.querySelectorAll<HTMLElement>('[data-clip-id]') ?? []) {
				const clip = clipById.get(target.dataset.clipId ?? '');
				const loop = clip ? readClipLoop(clip) : null;
				const trim = target.querySelector<HTMLElement>('.clip-display__handle--trim-right');
				if (trim && clip) {
					const hasRepeats = clipHasLoopRepeats(clip);
					const firstEnd = clip.timelineStartFrame + (loop?.periodFrames ?? clip.durationFrames) - (loop?.offsetFrames ?? 0);
					applyLoopTrimStyle(trim, hasRepeats, firstEnd, startFrame, Math.min(clip.timelineStartFrame + clip.durationFrames, endFrame), pixelsPerSecond, sampleRate);
				}
				if (clip && clipCanLoop(clip)) next.set(clip.id, target);
			}
			setTargets(current => current.size === next.size && [...next].every(([id, target]) => current.get(id) === target) ? current : next);
		};
		if (rootRef.current) refresh();
		else queueMicrotask(refresh);
		return () => { active = false; };
	}, [clipById, clips, rootRef, startFrame, endFrame, pixelsPerSecond, sampleRate, selectedIds]);
	return presentations.map(({ clip, normalized, loop, visibleStart, boundaries }) => {
		const target = targets.get(clip.id);
		if (!target) return null;
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
					onChange(clip.id, { loop: { periodFrames: loop.periodFrames, durationFrames: Math.max(1, normalized.durationFrames + delta),
						...(normalized === clip ? {} : { offsetFrames: 0, sourceStartFrame: normalized.sourceStartFrame, sourceDurationFrames: normalized.sourceDurationFrames }) } });
				}}>
				<Icon name="loop" size={14} />
			</button>}
		</>, target, `loop-${clip.id}`);
	});
}
