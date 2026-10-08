/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { ClipHeader } from '@soundscaper/design-system/ClipHeader';
import { ContextMenu } from '@soundscaper/design-system/ContextMenu';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { normalizeAudioWarpMap } from '../../audio-warp-domain.ts';
import { clipSourceDisplayRange, clipSourceFrameToDisplay, clipDisplayFrameToSource } from '../../clip-source-timing.ts';
import { AUDIO_EDITOR_TRACK_DISPLAY_MODES, type TrackDisplayMode } from '../../track-display-mode.ts';
import { renderAmplitudeRulers, renderFrequencyRulers } from '../timeline/track-row-helpers.jsx';
import { useNonPassiveWheel } from '../useNonPassiveWheel.js';
import { feedbackFailure, usePresentationFeedback } from '../presentation-feedback.ts';
import ClipSourceWaveforms from './ClipSourceWaveforms.tsx';
import ClipSourceFades from './ClipSourceFades.tsx';
import { fadeDurationAtPointer, fadeShapeAtPointer, fadeField, fadeShapeField } from '../timeline/clip-fade-geometry.ts';
import { clipSourceStretchFeedback, formatSourceStretchSpeed } from './clip-source-stretch-feedback.ts';
import ClipSourceRuler, { INITIAL_SOURCE_RULER_OPTIONS } from './ClipSourceRuler.tsx';
import { clipSourceSelection } from './clip-source-selection.ts';
import { clipSourceTrim } from './clip-source-view.ts';
import { useClipSourceMarkerDeletion } from './useClipSourceMarkerDeletion.ts';
import type { TimelineAudioBuffer } from '../timeline/waveform-view-model.ts';
import type { ClipSourceController, ClipSourceProject, SourceSelection } from './clip-source-editor-types.ts';

interface Props {
	readonly controller: ClipSourceController;
	readonly project: ClipSourceProject;
	readonly clipId: string;
	readonly copy: Readonly<Record<string, string>>;
	readonly blocked: boolean;
	readonly previewBlocked?: boolean;
}
const amplitudeRulers = renderAmplitudeRulers as (channels: number, height: number, width: number, mode: string, format: string, zoom: number, ratio: number) => ReactNode;

type Gesture = { readonly kind: 'selection' | 'start' | 'end' | 'fade-in' | 'fade-out' | 'shape-in' | 'shape-out' | 'marker'; readonly startFrame: number; readonly pointIndex?: number;
	readonly startX: number; readonly startY: number; readonly pointerId: number; readonly initialSelection: SourceSelection | null; readonly initialValue?: number; readonly gainHeight?: number; readonly baseGain?: number; readonly startGain?: number };

export default function ClipSourceEditor({ controller, project, clipId, copy, blocked, previewBlocked = blocked }: Props) {
	const clip = project.clips.find(candidate => candidate.id === clipId)!;
	const source = project.sources.find(candidate => candidate.id === clip.sourceId)!;
	const preview = controller.actions.clipSourcePreview;
	const range = clipSourceDisplayRange(clip, source, project.sampleRate);
	const rootRef = useRef<HTMLDivElement>(null);
	const waveRef = useRef<HTMLDivElement>(null);
	const deleteMarker = useClipSourceMarkerDeletion(waveRef, clip.warpMap);
	const [size, setSize] = useState({ width: 600, height: 210 });
	const [view, setView] = useState<SourceSelection | null>(null);
	const startFrame = Math.min(view?.startFrame ?? 0, Math.max(0, range.totalFrames - 1));
	const endFrame = Math.max(startFrame + 1, Math.min(view?.endFrame ?? range.totalFrames, range.totalFrames));
	const [selection, setSelection] = useState<SourceSelection | null>(null);
	const [displayMode, setDisplayMode] = useState<TrackDisplayMode>('waveform');
	const [verticalZoom, setVerticalZoom] = useState(0);
	const [ruler, setRuler] = useState(INITIAL_SOURCE_RULER_OPTIONS);
	const [transport, setTransport] = useState(() => preview.snapshot());
	const [error, setError] = usePresentationFeedback(copy);
	const [menu, setMenu] = useState<{ kind: 'view' | 'wave'; x: number; y: number; frame: number } | null>(null);
	const [dragFrame, setDragFrame] = useState<number | null>(null);
	const [fadePreview, setFadePreview] = useState<Readonly<Record<string, number>> | null>(null);
	const [focusedMarker, setFocusedMarker] = useState<number | null>(null);
	const gesture = useRef<Gesture | null>(null);
	const selectedRef = useRef(selection);
	selectedRef.current = selection;
	const width = Math.max(1, size.width - 96);
	const [loadedAudio, setLoadedAudio] = useState<{ sourceId: string; buffer: TimelineAudioBuffer } | null>(null);
	const rawVisual = controller.getClipVisualData(clipId);
	const visual = loadedAudio?.sourceId === source.id ? { ...rawVisual, buffer: loadedAudio.buffer } : rawVisual;
	const available = Boolean(visual?.available && (visual.buffer || visual.peaks));
	const run = (action: () => unknown) => {
		setError('');
		try { void Promise.resolve(action()).catch(cause => setError(feedbackFailure(cause))); }
		catch (cause) { setError(feedbackFailure(cause)); }
	};
	const pixel = (frame: number) => (frame - startFrame) / (endFrame - startFrame) * width;
	const sourceAt = (frame: number) => Math.round(clipDisplayFrameToSource(project, clip, source, frame));
	const frameAt = (clientX: number) => {
		const rect = waveRef.current?.getBoundingClientRect();
		return Math.round(Math.max(0, Math.min(range.totalFrames, startFrame + (clientX - (rect?.left ?? 0)) / Math.max(1, rect?.width ?? width) * (endFrame - startFrame))));
	};
	const applySelection = (requested: SourceSelection | null) => {
		const normalized = clipSourceSelection(project, clip, source, requested);
		setSelection(normalized.display);
		preview.setSelection(normalized.display);
		controller.actions.effects.setSourceSelection({ clipId, ...normalized.source });
	};
	const focus = () => run(() => { preview.focus(clipId); applySelection(selectedRef.current); });
	const restoreSourceFocus = useRef(() => {});
	restoreSourceFocus.current = () => run(() => { preview.focus(clipId); applySelection(selectedRef.current); });
	useEffect(() => {
		if (transport.focused && transport.clipId === clipId) restoreSourceFocus.current();
		else controller.actions.effects.setSourceSelection(null);
	}, [transport.focused, transport.clipId, clipId, controller]);
	const contentKey = useMemo(() => JSON.stringify([clip, source.id, source.frameCount]), [clip, source.id, source.frameCount]);
	const previousContent = useRef(contentKey);
	useEffect(() => {
		if (previousContent.current === contentKey) return;
		previousContent.current = contentKey;
		preview.stop();
		const current = preview.snapshot();
		if (current.focused && current.clipId === clipId) restoreSourceFocus.current();
		else setSelection(value => clipSourceSelection(project, clip, source, value).display);
	}, [contentKey, preview, project, clip, source, clipId]);
	useEffect(() => preview.subscribe(() => setTransport(preview.snapshot())), [preview]);
	useEffect(() => {
		const element = rootRef.current;
		if (!element || typeof ResizeObserver !== 'function') return;
		const observer = new ResizeObserver(([entry]) => {
			if (entry) setSize({ width: entry.contentRect.width, height: Math.max(150, entry.contentRect.height - 40) });
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		const release = (event: Event) => {
			if (event.target instanceof Element && !rootRef.current?.contains(event.target) && event.target.closest('[data-timeline], [data-track-row], .kw-audio-editor__transport, [data-transport]')) {
				preview.blur(); controller.actions.effects.setSourceSelection(null);
			}
		};
		document.addEventListener('focusin', release);
		document.addEventListener('pointerdown', release);
		return () => { document.removeEventListener('focusin', release); document.removeEventListener('pointerdown', release); preview.blur(); controller.actions.effects.setSourceSelection(null); };
	}, [controller, preview, clipId]);
	useEffect(() => {
		if (displayMode === 'waveform-three-band' || displayMode === 'waveform-rainbow') {
			void controller.actions.timeline.requestFrequencyWaveform?.(clipId).catch(cause => setError(feedbackFailure(cause)));
		}
		let current = true;
		if (!visual?.buffer && (displayMode === 'spectrogram' || displayMode === 'multiview')) {
			void controller.actions.effects.loadSourceAudio?.(clipId).then(buffer => {
				if (current) setLoadedAudio({ sourceId: source.id, buffer });
			}).catch(cause => { if (current) setError(feedbackFailure(cause)); });
		}
		return () => { current = false; };
	}, [controller, clipId, source.id, displayMode, visual?.buffer, setError]);
	useEffect(() => {
		if (!(transport.state === 'playing') || !view || !ruler.scroll) return;
		const span = endFrame - startFrame;
		if (!ruler.pinned && transport.positionFrame >= startFrame && transport.positionFrame <= endFrame) return;
		const next = Math.max(0, Math.min(range.totalFrames - span, transport.positionFrame - (ruler.pinned ? span / 2 : 0)));
		setView({ startFrame: next, endFrame: next + span });
	}, [transport, ruler.scroll, ruler.pinned, view, startFrame, endFrame, range.totalFrames]);
	useNonPassiveWheel(waveRef, (event: WheelEvent) => {
		event.preventDefault(); event.stopPropagation();
		const span = endFrame - startFrame;
		const nextSpan = event.ctrlKey || event.metaKey ? Math.max(64, Math.min(range.totalFrames, span * (event.deltaY > 0 ? 1.25 : 0.8))) : span;
		const anchor = frameAt(event.clientX);
		const nextStart = Math.max(0, Math.min(range.totalFrames - nextSpan,
			nextSpan !== span ? anchor - (anchor - startFrame) / span * nextSpan : startFrame + (event.deltaX || event.deltaY) / width * span));
		setView({ startFrame: nextStart, endFrame: nextStart + nextSpan });
	});
	const begin = (event: PointerEvent<HTMLElement>, kind: Gesture['kind'], pointIndex?: number) => {
		if (event.button !== 0 || blocked) return;
		const handle = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-clip-fade-handle], [data-clip-fade-shape-handle]') : null;
		if (handle?.dataset.clipFadeHandle) kind = handle.dataset.clipFadeHandle === 'in' ? 'fade-in' : 'fade-out';
		if (handle?.dataset.clipFadeShapeHandle) kind = handle.dataset.clipFadeShapeHandle === 'in' ? 'shape-in' : 'shape-out';
		event.preventDefault(); event.stopPropagation(); (handle ?? waveRef.current)?.focus(); focus();
		const frame = frameAt(event.clientX);
		if (kind === 'selection' && (event.ctrlKey || event.metaKey)) {
			if (frame >= range.startFrame && frame <= range.endFrame) run(() => controller.actions.audioWarp.addSourceMarker(clipId, sourceAt(frame)));
			return;
		}
		const edge = kind.endsWith('-in') ? 'in' : 'out';
		gesture.current = { kind, startFrame: frame, pointIndex, startX: event.clientX, startY: event.clientY, pointerId: event.pointerId, initialSelection: selectedRef.current,
			initialValue: kind.startsWith('shape-') ? clip[fadeShapeField(edge)] ?? 2 : clip[fadeField(edge)] ?? 0,
			gainHeight: handle?.closest('.audio-editor-clip-fade')?.getBoundingClientRect().height,
			baseGain: handle?.dataset.fadeShapeBaseGain ? Number(handle.dataset.fadeShapeBaseGain) : undefined,
			startGain: handle?.dataset.fadeShapeStartGain ? Number(handle.dataset.fadeShapeStartGain) : undefined };
		setDragFrame(frame);
		waveRef.current?.setPointerCapture(event.pointerId);
		if (kind === 'selection') setSelection({ startFrame: frame, endFrame: frame });
	};
	const fadeChanges = (current: Gesture, event: PointerEvent<HTMLElement>) => {
		const edge = current.kind.endsWith('-in') ? 'in' : 'out';
		return current.kind.startsWith('shape-')
			? { [fadeShapeField(edge)]: fadeShapeAtPointer(current.initialValue!, current.startY, event.clientY, current.gainHeight ?? 100, current.baseGain, current.startGain) }
			: { [fadeField(edge)]: fadeDurationAtPointer(edge, current.initialValue!, current.startX, event.clientX, width * project.sampleRate / (endFrame - startFrame), project.sampleRate, clip.durationFrames) };
	};
	const move = (event: PointerEvent<HTMLDivElement>) => {
		const current = gesture.current; if (!current) return;
		const frame = frameAt(event.clientX); setDragFrame(frame);
		if (current.kind === 'selection') setSelection({ startFrame: Math.min(current.startFrame, frame), endFrame: Math.max(current.startFrame, frame) });
		if (current.kind.startsWith('fade-') || current.kind.startsWith('shape-')) setFadePreview(fadeChanges(current, event));
	};
	const moveMarker = (pointIndex: number, frame: number) => {
		const feedback = clipSourceStretchFeedback(project, clip, source, pointIndex, frame);
		if (feedback?.canMove) run(() => controller.actions.audioWarp.moveSourceMarker(clipId, pointIndex, feedback.displayFrame - range.startFrame));
	};
	const finish = (event: PointerEvent<HTMLDivElement>) => {
		const current = gesture.current; if (!current) return;
		gesture.current = null; setDragFrame(null); setFadePreview(null);
		const frame = frameAt(event.clientX);
		if (current.kind === 'selection') {
			run(() => { applySelection(frame === current.startFrame ? null : { startFrame: Math.min(current.startFrame, frame), endFrame: Math.max(current.startFrame, frame) }); preview.seek(frame); });
		} else if (current.kind === 'start' || current.kind === 'end') {
			run(() => preview.trim(clipId, clipSourceTrim(clip, source, project.sampleRate, current.kind as 'start' | 'end', clip.reversed ? clip.sourceStartFrame + (frame - range.startFrame) / clip.durationFrames * clip.sourceDurationFrames : sourceAt(frame))));
		} else if (current.kind === 'marker') {
			moveMarker(current.pointIndex!, frame);
		} else {
			run(() => controller.actions.clip.update(clipId, fadeChanges(current, event)));
		}
	};
	const cancelGesture = () => {
		const current = gesture.current;
		if (current?.kind === 'selection') setSelection(current.initialSelection);
		if (current && waveRef.current?.hasPointerCapture?.(current.pointerId)) waveRef.current.releasePointerCapture(current.pointerId);
		gesture.current = null; setDragFrame(null); setFadePreview(null);
	};
	const previewClip = useMemo(() => fadePreview ? { ...clip, ...fadePreview } : clip, [clip, fadePreview]);
	const fadeClip = useMemo(() => ({ ...previewClip, timelineStartFrame: range.startFrame }), [previewClip, range.startFrame]);
	const markerIndex = gesture.current?.kind === 'marker' ? gesture.current.pointIndex! : focusedMarker;
	const markerFeedback = markerIndex === null ? null : clipSourceStretchFeedback(project, clip, source, markerIndex, gesture.current?.kind === 'marker' ? dragFrame ?? undefined : undefined);
	const markerDescription = (pointIndex: number) => {
		const feedback = pointIndex === markerIndex ? markerFeedback : clipSourceStretchFeedback(project, clip, source, pointIndex);
		return feedback ? `${copy.clipSourceSpeedBefore}: ${formatSourceStretchSpeed(feedback.beforeSpeed)}; ${copy.clipSourceSpeedAfter}: ${formatSourceStretchSpeed(feedback.afterSpeed)}` : '';
	};
	const markers = clip.warpMap ? normalizeAudioWarpMap(clip.warpMap).points.slice(1, -1) : [];
	const labels: Record<TrackDisplayMode, string> = { waveform: copy.waveformView, spectrogram: copy.spectrogramView, multiview: copy.multiview,
		'half-wave': copy.halfWave, 'waveform-three-band': copy.threeBandWaveformView, 'waveform-rainbow': copy.rainbowWaveformView };
	const spectral = displayMode === 'spectrogram' || displayMode === 'multiview';
	const bodyHeight = size.height - 24;
	return <div ref={rootRef} className="audio-editor-clip-source-editor" data-clip-source-editor onFocusCapture={focus}
		onKeyDownCapture={event => { if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); cancelGesture(); } }}
		onKeyDown={event => {
			if (event.defaultPrevented || event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
			if (event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); run(() => preview.playPause(clipId)); }
			if (event.key === 'Escape') { gesture.current = null; setDragFrame(null); setFadePreview(null); run(() => preview.stop()); }
			if ((event.ctrlKey || event.metaKey) && event.key === 'a') { event.preventDefault(); event.stopPropagation(); run(() => applySelection({ startFrame: 0, endFrame: range.totalFrames })); }
		}}>
		<ClipSourceRuler copy={copy} width={width} sampleRate={project.sampleRate} startFrame={startFrame} endFrame={endFrame}
			clipStartFrame={range.startFrame} projectStartFrame={clip.timelineStartFrame} tempoMap={project.tempoMap} signatureMap={project.signatureMap}
			positionFrame={transport.positionFrame} onSeekFrame={frame => run(() => preview.seek(frame))}
			options={ruler} onOptions={setRuler} playing={(transport.state === 'playing')} loop={transport.loop} loopRange={transport.loopRange} selection={selection} disabled={previewBlocked || !available}
			onPlay={() => run(() => preview.playPause(clipId))} onStop={() => run(() => preview.stop())} onLoop={() => run(() => preview.setLoop(!transport.loop))}
			onClearLoop={() => run(() => { preview.setLoop(false); preview.setLoopRange(null); })}
			onLoopSelection={() => run(() => { preview.setLoopRange(selection); preview.setLoop(true); if (ruler.selectionFollows) applySelection(selection ?? { startFrame: 0, endFrame: range.totalFrames }); })}
			onSelectionLoop={() => run(() => applySelection(transport.loopRange ?? { startFrame: 0, endFrame: range.totalFrames }))}
			onSeek={event => { if (event.button !== 0) return; event.preventDefault(); focus(); run(() => { preview.seek(frameAt(event.clientX)); if (ruler.clickToPlay && !(transport.state === 'playing')) return preview.playPause(clipId); }); }} />
		<div className="audio-editor-source-body">
			<div className="audio-editor-source-vertical-ruler" role="region" aria-label={copy.clipSourceVerticalRuler} tabIndex={0}
				onContextMenu={event => { event.preventDefault(); setMenu({ kind: 'view', x: event.clientX, y: event.clientY, frame: 0 }); }}
				onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setMenu({ kind: 'view', x: rect.left, y: rect.bottom, frame: 0 }); } }}>
				{spectral && renderFrequencyRulers(source.channelCount, displayMode === 'multiview' ? bodyHeight / 2 : bodyHeight, 40, 0, source.sampleRate / 2, 'linear', 0.5)}
				{displayMode !== 'spectrogram' && amplitudeRulers(source.channelCount, displayMode === 'multiview' ? bodyHeight / 2 : bodyHeight, 40, displayMode, 'linear-db', verticalZoom, 0.5)}
			</div>
			<div ref={waveRef} className="audio-editor-source-wave-area" role="region" aria-label={copy.clipSourceWaveform} tabIndex={0}
				data-source-frame-count={source.frameCount} data-source-gesture={gesture.current?.kind} onPointerDown={event => begin(event, 'selection')} onPointerMove={move} onPointerUp={finish}
				onPointerCancel={cancelGesture}
				onContextMenu={event => { event.preventDefault(); setMenu({ kind: 'wave', x: event.clientX, y: event.clientY, frame: frameAt(event.clientX) }); }}>
				{visual && <ClipSourceWaveforms project={project} clip={previewClip} source={source} visual={visual} width={width} startFrame={startFrame} endFrame={endFrame}
					displayMode={displayMode} verticalZoom={verticalZoom} selection={selection} copy={copy}
					loadSourceAudioWindow={controller.actions.effects.loadSourceAudioWindow} onLoadError={cause => setError(feedbackFailure(cause))} />}
				<div className="audio-editor-source-clip" style={{ left: pixel(range.startFrame), width: pixel(range.endFrame) - pixel(range.startFrame) }} data-source-clip-overlay>
					<div onPointerDown={event => event.stopPropagation()}><ClipHeader name={clip.title || source.name || copy.clip} selected width={pixel(range.endFrame) - pixel(range.startFrame)} showMenu={false}
						onRename={title => run(() => controller.actions.clip.update(clipId, { title }))} /></div>
					{(['start', 'end'] as const).map(edge => <button key={edge} type="button" className={`audio-editor-source-trim audio-editor-source-trim--${edge}`}
						aria-label={edge === 'start' ? copy.clipSourceTrimStart : copy.clipSourceTrimEnd} disabled={blocked} onPointerDown={event => begin(event, edge)}
						onKeyDown={event => { if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return; if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); const frame = (edge === 'start' ? clip.sourceStartFrame : clip.sourceStartFrame + clip.sourceDurationFrames) + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? Math.round(source.sampleRate / 10) : 1); run(() => preview.trim(clipId, clipSourceTrim(clip, source, project.sampleRate, edge, frame))); } }} />)}

				</div>
				<ClipSourceFades rootRef={waveRef} clip={fadeClip} startFrame={startFrame} endFrame={endFrame} width={width} sampleRate={project.sampleRate}
					blocked={blocked} copy={copy} onChange={(id, changes) => run(() => controller.actions.clip.update(id, changes))} />
				{selection && <div className="audio-editor-source-selection" style={{ left: pixel(selection.startFrame), width: pixel(selection.endFrame) - pixel(selection.startFrame) }} />}
				{markers.map((marker, index) => <button key={`${marker.source.num}/${marker.source.den}`} type="button" className="audio-editor-source-stretch-marker"
					aria-label={`${copy.clipSourceStretchMarker} ${index + 1}`} title={`${copy.samplePosition} ${marker.source.num / marker.source.den}; ${markerDescription(index + 1)}`} aria-description={markerDescription(index + 1)} disabled={blocked}
					onFocus={() => setFocusedMarker(index + 1)} onBlur={() => setFocusedMarker(null)}
					data-source-sample={marker.source.num / marker.source.den} style={{ left: pixel(index + 1 === markerIndex && markerFeedback ? markerFeedback.displayFrame : clipSourceFrameToDisplay(project, clip, source, marker.source.num / marker.source.den)) }}
					onPointerDown={event => begin(event, 'marker', index + 1)} onKeyDown={event => {
						if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
						if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); deleteMarker(event.currentTarget, () => run(() => controller.actions.audioWarp.deleteSourceMarker(clipId, index + 1))); }
						if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); moveMarker(index + 1, clipSourceFrameToDisplay(project, clip, source, marker.source.num / marker.source.den) + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? Math.round(project.sampleRate / 10) : 1)); }
					}} />)}
				{markerFeedback && <div className="audio-editor-source-stretch-feedback" role="status" aria-live="polite"
					style={{ left: Math.max(0, Math.min(width - 240, pixel(markerFeedback.displayFrame) - 120)) }}>
					<span data-source-speed="before"><small>{copy.clipSourceSpeedBefore}</small>{formatSourceStretchSpeed(markerFeedback.beforeSpeed)}</span>
					<span data-source-speed="after"><small>{copy.clipSourceSpeedAfter}</small>{formatSourceStretchSpeed(markerFeedback.afterSpeed)}</span>
				</div>}
				<div className="audio-editor-source-playhead" style={{ left: pixel(transport.positionFrame) }} />
				{dragFrame !== null && <div className="audio-editor-source-drag-guide" style={{ left: pixel(dragFrame) }} />}
			</div>
		</div>
		<ContextMenu isOpen={Boolean(menu)} x={menu?.x ?? 0} y={menu?.y ?? 0} onClose={() => setMenu(null)} autoFocus>
			{menu?.kind === 'view' ? <>
				{AUDIO_EDITOR_TRACK_DISPLAY_MODES.map(mode => <ContextMenuItem key={mode} label={labels[mode]} checked={displayMode === mode} onClick={() => setDisplayMode(mode)} onClose={() => setMenu(null)} />)}
				<ContextMenuItem isDivider />
				<ContextMenuItem label={copy.zoomIn} onClick={() => setVerticalZoom(Math.min(10, verticalZoom + 1))} onClose={() => setMenu(null)} />
				<ContextMenuItem label={copy.zoomOut} onClick={() => setVerticalZoom(Math.max(0, verticalZoom - 1))} onClose={() => setMenu(null)} />
			</> : <>
				<ContextMenuItem label={copy.clipSourceAddMarker} disabled={blocked || !menu || menu.frame <= range.startFrame || menu.frame >= range.endFrame} onClick={() => run(() => controller.actions.audioWarp.addSourceMarker(clipId, sourceAt(menu!.frame)))} onClose={() => setMenu(null)} />
				<ContextMenuItem label={copy.selectAll} onClick={() => run(() => applySelection({ startFrame: 0, endFrame: range.totalFrames }))} onClose={() => setMenu(null)} />
				<ContextMenuItem label={copy.clipSourceFit} onClick={() => setView(null)} onClose={() => setMenu(null)} />
			</>}
		</ContextMenu>
		{error && <p role="alert" className="audio-editor-field-error">{error}</p>}
	</div>;
}
