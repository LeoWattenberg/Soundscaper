/* SPDX-License-Identifier: AGPL-3.0-only */
import { useMemo, useRef, useState } from 'react';
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
}
interface Gesture { readonly edge: 'in' | 'out'; readonly startX: number; readonly initial: number; readonly pointerId: number }

/** Uses the audio quick-fade glyphs while committing video opacity keyframes. */
export function VideoClipFadeHandles({ controller, project, clip, selected, visibleStartFrame, visibleEndFrame, pixelsPerSecond, sampleRate, blocked, copy, run }: Props) {
	const rawClip = project.clips?.find(({ id }) => id === clip.id);
	const envelope = useMemo(() => {
		try { return rawClip?.videoKeyframes ? readVideoFadeEnvelope(rawClip) : null; } catch { return null; }
	}, [rawClip]);
	const [preview, setPreview] = useState<VideoFadeEnvelope | null>(null);
	const gesture = useRef<Gesture | null>(null);
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
					if (event.button !== 0 || blocked) return;
					event.preventDefault(); event.stopPropagation();
					gesture.current = { edge, initial: value, startX: event.clientX, pointerId: event.pointerId };
					event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus();
				}}
				onPointerMove={event => {
					const session = gesture.current;
					if (!session || session.pointerId !== event.pointerId) return;
					event.stopPropagation();
					setPreview({ ...envelope, [edge === 'in' ? 'fadeInFrames' : 'fadeOutFrames']: durationAt(session, event.clientX) });
				}}
				onPointerUp={event => {
					const session = gesture.current;
					if (!session || session.pointerId !== event.pointerId) return;
					event.stopPropagation(); gesture.current = null; setPreview(null);
					const duration = durationAt(session, event.clientX);
					if (!blocked && duration !== session.initial) update(edge, duration);
				}}
				onPointerCancel={() => { gesture.current = null; setPreview(null); }}
				onKeyDown={event => {
					event.stopPropagation();
					if (event.altKey || event.ctrlKey || event.metaKey || blocked) return;
					const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
					const duration = event.key === 'Home' ? 0 : event.key === 'End' ? rawClip.sequenceFrameCount : delta ? value + delta * (event.shiftKey ? 10 : 1) : null;
					if (duration === null) return;
					event.preventDefault(); update(edge, duration);
				}} />;
		})}
	</div>;
}
