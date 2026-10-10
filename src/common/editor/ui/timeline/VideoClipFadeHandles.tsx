/* SPDX-License-Identifier: AGPL-3.0-only */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TrackFadeHandle } from '@soundscaper/design-system/Track/TrackFadeHandle';

import { createSetVideoKeyframesCommand } from '../../commands/factories.ts';
import { createVideoFadeKeyframes, readVideoFadeEnvelope } from './video-fade-envelope.ts';
import type { VideoFadeClip, VideoFadeEnvelope } from './video-fade-envelope.ts';

interface ProjectClip extends VideoFadeClip { readonly id: string }
interface DisplayClip { readonly id: string; readonly durationFrames: number; readonly timelineStartFrame: number; readonly kind?: string }
interface Props {
	readonly controller: { readonly actions: { readonly edit: { commit(command: ReturnType<typeof createSetVideoKeyframesCommand>): unknown } } };
	readonly project: { readonly clips: readonly ProjectClip[] };
	readonly clip: DisplayClip;
	readonly selected: boolean;
	readonly visibleStartFrame: number;
	readonly visibleEndFrame: number;
	readonly pixelsPerSecond: number;
	readonly sampleRate: number;
	readonly blocked: boolean;
	readonly copy: Readonly<Record<string, string>>;
	readonly run: (operation: () => unknown) => unknown;
	readonly onTabOut?: () => unknown;
}
interface Gesture {
	readonly edge: 'in' | 'out'; readonly startX: number; readonly initial: number; readonly pointerId: number;
	readonly authority: string; readonly target: HTMLButtonElement;
}

/** Uses the audio quick-fade glyphs while committing video opacity keyframes. */
export function VideoClipFadeHandles({ controller, project, clip, selected, visibleStartFrame, visibleEndFrame, pixelsPerSecond, sampleRate, blocked, copy, run, onTabOut }: Props) {
	const rawClip = project.clips?.find(({ id }) => id === clip.id);
	const envelope = useMemo(() => {
		try { return rawClip?.videoKeyframes ? readVideoFadeEnvelope(rawClip) : null; } catch { return null; }
	}, [rawClip]);
	const [preview, setPreview] = useState<VideoFadeEnvelope | null>(null);
	const gesture = useRef<Gesture | null>(null);
	const opacityAuthority = useMemo(() => JSON.stringify([rawClip?.id, rawClip?.sequenceFrameCount, clip.durationFrames,
		rawClip?.videoComposition.opacity, rawClip?.videoKeyframes.timeDomain,
		rawClip?.videoKeyframes.curves.filter(({ target }) => target.kind === 'composition' && target.parameterId === 'opacity'),
	]), [rawClip, clip.durationFrames]);
	useLayoutEffect(() => {
		const session = gesture.current;
		if (!session || session.authority === opacityAuthority) return;
		gesture.current = null; setPreview(null);
		if (session.target.hasPointerCapture?.(session.pointerId)) session.target.releasePointerCapture(session.pointerId);
	}, [opacityAuthority]);
	if (!rawClip || !envelope || clip.kind !== 'video') return null;
	const current = preview ?? envelope;
	const scale = clip.durationFrames / rawClip.sequenceFrameCount;
	const width = (visibleEndFrame - visibleStartFrame) / sampleRate * pixelsPerSecond;
	const boundary = (edge: 'in' | 'out'): number => ((clip.timelineStartFrame + (edge === 'in'
		? current.fadeInFrames * scale : clip.durationFrames - current.fadeOutFrames * scale)) - visibleStartFrame) / sampleRate * pixelsPerSecond;
	const update = (edge: 'in' | 'out', value: number): void => {
		run(() => controller.actions.edit.commit(createSetVideoKeyframesCommand(rawClip.id, rawClip.videoKeyframes, createVideoFadeKeyframes(rawClip, edge, value))));
	};
	const durationAt = (session: Gesture, clientX: number): number => {
		const delta = (clientX - session.startX) / pixelsPerSecond * sampleRate / scale;
		return Math.max(0, Math.min(rawClip.sequenceFrameCount - (session.edge === 'in' ? envelope.fadeOutFrames : envelope.fadeInFrames),
			Math.round(session.initial + (session.edge === 'in' ? delta : -delta))));
	};
	const finishGesture = (session: Gesture, clientX: number): void => {
		gesture.current = null; setPreview(null);
		const duration = durationAt(session, clientX);
		if (!blocked && duration !== session.initial) update(session.edge, duration);
	};
	return <div className="audio-editor-clip-fade audio-editor-video-clip-fade">
		{(current.fadeInFrames > 0 || current.fadeOutFrames > 0) && <svg className="audio-editor-clip-fade__curve" viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" aria-hidden="true">
			{(['in', 'out'] as const).map(edge => {
				const length = edge === 'in' ? current.fadeInFrames : current.fadeOutFrames;
				if (!length) return null;
				const start = (clip.timelineStartFrame - visibleStartFrame) / sampleRate * pixelsPerSecond;
				const end = (clip.timelineStartFrame + clip.durationFrames - visibleStartFrame) / sampleRate * pixelsPerSecond;
				return <path key={edge} data-fade-curve={edge} d={edge === 'in' ? `M ${start},100 L ${boundary(edge)},0` : `M ${boundary(edge)},0 L ${end},100`}
					fill="none" stroke="rgba(0, 0, 0, 0.55)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />;
			})}
		</svg>}
		{selected && (['in', 'out'] as const).map(edge => {
			const x = boundary(edge);
			if (x < 0 || x > width) return null;
			const value = edge === 'in' ? current.fadeInFrames : current.fadeOutFrames;
			return <TrackFadeHandle key={edge} edge={edge} clipWidth={Math.round(width)} boundaryX={x}
				oppositeBoundaryX={boundary(edge === 'in' ? 'out' : 'in')} data-video-clip-fade-handle={edge}
				aria-label={edge === 'in' ? copy.fadeIn : copy.fadeOut} aria-valuemin={0}
				aria-valuemax={clip.durationFrames / sampleRate} aria-valuenow={value * scale / sampleRate}
				aria-orientation="horizontal" tabIndex={-1} disabled={blocked}
				onClick={event => { event.stopPropagation(); }}
				onPointerDown={event => {
					if (event.button !== 0 || blocked || gesture.current) return;
					event.preventDefault(); event.stopPropagation();
					gesture.current = { edge, initial: value, startX: event.clientX, pointerId: event.pointerId,
						authority: opacityAuthority, target: event.currentTarget };
					event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus();
				}}
				onPointerMove={event => {
					const session = gesture.current;
					if (!session || session.pointerId !== event.pointerId) return;
					event.stopPropagation();
					if (event.pointerType === 'mouse' && !(event.buttons & 1)) {
						finishGesture(session, event.clientX);
						return;
					}
					setPreview({ ...envelope, [edge === 'in' ? 'fadeInFrames' : 'fadeOutFrames']: durationAt(session, event.clientX) });
				}}
				onPointerUp={event => {
					const session = gesture.current;
					if (!session || session.pointerId !== event.pointerId) return;
					if (event.pointerType === 'mouse' && event.button !== 0) return;
					event.stopPropagation();
					finishGesture(session, event.clientX);
				}}
				onPointerCancel={event => {
					if (gesture.current?.pointerId !== event.pointerId) return;
					gesture.current = null; setPreview(null);
				}}
				onKeyDown={event => {
					if (event.altKey || event.ctrlKey || event.metaKey) return;
					if (event.key === 'Escape' && gesture.current) {
						event.preventDefault(); event.stopPropagation();
						const pointerId = gesture.current.pointerId;
						gesture.current = null; setPreview(null);
						if (event.currentTarget.hasPointerCapture?.(pointerId)) event.currentTarget.releasePointerCapture(pointerId);
						return;
					}
					if (event.key === 'Tab') {
						const target = event.currentTarget.closest<HTMLElement>('[data-clip-id][role="group"]');
						if (!target) return;
						event.preventDefault(); event.stopPropagation();
						const handles = [...target.querySelectorAll<HTMLButtonElement>('[data-video-clip-fade-handle]:not(:disabled)')];
						const next = handles[handles.indexOf(event.currentTarget) + (event.shiftKey ? -1 : 1)];
						if (next) next.focus();
						else if (event.shiftKey) target.focus();
						else onTabOut?.();
						return;
					}
					if (blocked) return;
					const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
					const duration = event.key === 'Home' ? 0 : event.key === 'End' ? rawClip.sequenceFrameCount : delta ? value + delta * (event.shiftKey ? 10 : 1) : null;
					if (duration === null) return;
					event.preventDefault(); event.stopPropagation(); update(edge, duration);
				}} />;
		})}
	</div>;
}
