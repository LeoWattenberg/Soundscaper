/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
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
import ClipSourceRuler, { INITIAL_SOURCE_RULER_OPTIONS } from './ClipSourceRuler.tsx';
import { clipSourceSelection } from './clip-source-selection.ts';
import { clipSourceTrim } from './clip-source-view.ts';
import type { TimelineAudioBuffer } from '../timeline/waveform-view-model.ts';
import type { ClipSourceController, ClipSourceProject, SourceSelection } from './clip-source-editor-types.ts';

interface Props {
	readonly controller: ClipSourceController;
	readonly project: ClipSourceProject;
	readonly clipId: string;
	readonly copy: Readonly<Record<string, string>>;
	readonly blocked: boolean;
}
const amplitudeRulers = renderAmplitudeRulers as (channels: number, height: number, width: number, mode: string, format: string, zoom: number, ratio: number) => ReactNode;

type Gesture = { readonly kind: 'selection' | 'start' | 'end' | 'fade-in' | 'fade-out' | 'marker'; readonly startFrame: number; readonly pointIndex?: number };

export default function ClipSourceEditor({ controller, project, clipId, copy, blocked }: Props) {
	const clip = project.clips.find(candidate => candidate.id === clipId)!;
	const source = project.sources.find(candidate => candidate.id === clip.sourceId)!;
	const preview = controller.actions.clipSourcePreview;
	const range = clipSourceDisplayRange(clip, source, project.sampleRate);
	const rootRef = useRef<HTMLDivElement>(null);
	const waveRef = useRef<HTMLDivElement>(null);
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
	restoreSourceFocus.current = () => run(() => applySelection(selectedRef.current));
	useEffect(() => {
		if (transport.focused && transport.clipId === clipId) restoreSourceFocus.current();
		else controller.actions.effects.setSourceSelection(null);
	}, [transport.focused, transport.clipId, clipId, controller]);
	const contentKey = JSON.stringify([clip, source.id, source.frameCount]);
	const previousContent = useRef(contentKey);
	useEffect(() => {
		if (previousContent.current === contentKey) return;
		previousContent.current = contentKey;
		preview.stop();
		setSelection(value => clipSourceSelection(project, clip, source, value).display);
	}, [contentKey, preview, project, clip, source]);
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
		event.preventDefault(); event.stopPropagation(); waveRef.current?.focus(); focus();
		const frame = frameAt(event.clientX);
		if (kind === 'selection' && (event.ctrlKey || event.metaKey)) {
			if (frame >= range.startFrame && frame <= range.endFrame) run(() => controller.actions.audioWarp.addSourceMarker(clipId, sourceAt(frame)));
			return;
		}
		gesture.current = { kind, startFrame: frame, pointIndex }; setDragFrame(frame);
		waveRef.current?.setPointerCapture(event.pointerId);
		if (kind === 'selection') setSelection({ startFrame: frame, endFrame: frame });
	};
	const move = (event: PointerEvent<HTMLDivElement>) => {
		const current = gesture.current; if (!current) return;
		const frame = frameAt(event.clientX); setDragFrame(frame);
		if (current.kind === 'selection') setSelection({ startFrame: Math.min(current.startFrame, frame), endFrame: Math.max(current.startFrame, frame) });
	};
	const finish = (event: PointerEvent<HTMLDivElement>) => {
		const current = gesture.current; if (!current) return;
		gesture.current = null; setDragFrame(null);
		const frame = frameAt(event.clientX);
		if (current.kind === 'selection') {
			run(() => { applySelection(frame === current.startFrame ? null : { startFrame: Math.min(current.startFrame, frame), endFrame: Math.max(current.startFrame, frame) }); preview.seek(frame); });
		} else if (current.kind === 'start' || current.kind === 'end') {
			run(() => preview.trim(clipId, clipSourceTrim(clip, source, project.sampleRate, current.kind as 'start' | 'end', clip.reversed ? clip.sourceStartFrame + (frame - range.startFrame) / clip.durationFrames * clip.sourceDurationFrames : sourceAt(frame))));
		} else if (current.kind === 'marker') {
			run(() => controller.actions.audioWarp.moveSourceMarker(clipId, current.pointIndex!, frame - range.startFrame));
		} else {
			const field = current.kind === 'fade-in' ? 'fadeInFrames' : 'fadeOutFrames';
			run(() => controller.actions.clip.update(clipId, { [field]: Math.max(0, Math.min(clip.durationFrames, current.kind === 'fade-in' ? frame - range.startFrame : range.endFrame - frame)) }));
		}
	};
	const markers = clip.warpMap ? normalizeAudioWarpMap(clip.warpMap).points.slice(1, -1) : [];
	const labels: Record<TrackDisplayMode, string> = { waveform: copy.waveformView, spectrogram: copy.spectrogramView, multiview: copy.multiview,
		'half-wave': copy.halfWave, 'waveform-three-band': copy.threeBandWaveformView, 'waveform-rainbow': copy.rainbowWaveformView };
	const spectral = displayMode === 'spectrogram' || displayMode === 'multiview';
	const bodyHeight = size.height - 24;
	return <div ref={rootRef} className="audio-editor-clip-source-editor" data-clip-source-editor onFocusCapture={focus}
		onKeyDown={event => {
			if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
			if (event.code === 'Space') { event.preventDefault(); event.stopPropagation(); run(() => preview.playPause(clipId)); }
			if (event.key === 'Escape') { gesture.current = null; setDragFrame(null); run(() => preview.stop()); }
			if ((event.ctrlKey || event.metaKey) && event.key === 'a') { event.preventDefault(); event.stopPropagation(); run(() => applySelection({ startFrame: 0, endFrame: range.totalFrames })); }
		}}>
		<ClipSourceRuler copy={copy} width={width} sampleRate={project.sampleRate} startFrame={startFrame} endFrame={endFrame}
			clipStartFrame={range.startFrame} projectStartFrame={clip.timelineStartFrame} tempoMap={project.tempoMap} signatureMap={project.signatureMap}
			positionFrame={transport.positionFrame} onSeekFrame={frame => run(() => preview.seek(frame))}
			options={ruler} onOptions={setRuler} playing={(transport.state === 'playing')} loop={transport.loop} loopRange={transport.loopRange} selection={selection} disabled={blocked || !available}
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
				data-source-frame-count={source.frameCount} onPointerDown={event => begin(event, 'selection')} onPointerMove={move} onPointerUp={finish}
				onPointerCancel={() => { gesture.current = null; setDragFrame(null); }}
				onContextMenu={event => { event.preventDefault(); setMenu({ kind: 'wave', x: event.clientX, y: event.clientY, frame: frameAt(event.clientX) }); }}>
				{visual && <ClipSourceWaveforms project={project} clip={clip} source={source} visual={visual} width={width} startFrame={startFrame} endFrame={endFrame}
					displayMode={displayMode} verticalZoom={verticalZoom} selection={selection} copy={copy} />}
				<div className="audio-editor-source-clip" style={{ left: pixel(range.startFrame), width: pixel(range.endFrame) - pixel(range.startFrame) }} data-source-clip-overlay>
					<div onPointerDown={event => event.stopPropagation()}><ClipHeader name={clip.title || source.name || copy.clip} selected width={pixel(range.endFrame) - pixel(range.startFrame)} showMenu={false}
						onRename={title => run(() => controller.actions.clip.update(clipId, { title }))} /></div>
					{(['start', 'end'] as const).map(edge => <button key={edge} type="button" className={`audio-editor-source-trim audio-editor-source-trim--${edge}`}
						aria-label={edge === 'start' ? copy.clipSourceTrimStart : copy.clipSourceTrimEnd} disabled={blocked} onPointerDown={event => begin(event, edge)}
						onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); const frame = (edge === 'start' ? clip.sourceStartFrame : clip.sourceStartFrame + clip.sourceDurationFrames) + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? Math.round(source.sampleRate / 10) : 1); run(() => preview.trim(clipId, clipSourceTrim(clip, source, project.sampleRate, edge, frame))); } }} />)}
					{(['in', 'out'] as const).map(edge => <button key={edge} type="button" className="audio-editor-source-fade" aria-label={edge === 'in' ? copy.fadeIn : copy.fadeOut}
						style={{ left: edge === 'in' ? (clip.fadeInFrames ?? 0) / clip.durationFrames * 100 + '%' : (1 - (clip.fadeOutFrames ?? 0) / clip.durationFrames) * 100 + '%' }}
						disabled={blocked} onPointerDown={event => begin(event, edge === 'in' ? 'fade-in' : 'fade-out')}
						onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
							event.preventDefault(); event.stopPropagation(); const field = edge === 'in' ? 'fadeInFrames' : 'fadeOutFrames';
							const delta = (event.key === 'ArrowLeft' ? -1 : 1) * (edge === 'out' ? -1 : 1) * (event.shiftKey ? Math.round(project.sampleRate / 10) : 1);
							run(() => controller.actions.clip.update(clipId, { [field]: Math.max(0, Math.min(clip.durationFrames, (clip[field] ?? 0) + delta)) }));
						} }} />)}
				</div>
				{selection && <div className="audio-editor-source-selection" style={{ left: pixel(selection.startFrame), width: pixel(selection.endFrame) - pixel(selection.startFrame) }} />}
				{markers.map((marker, index) => <button key={`${marker.source.num}/${marker.source.den}`} type="button" className="audio-editor-source-stretch-marker"
					aria-label={`${copy.clipSourceStretchMarker} ${index + 1}`} title={`${copy.samplePosition} ${marker.source.num / marker.source.den}`} disabled={blocked}
					data-source-sample={marker.source.num / marker.source.den} style={{ left: pixel(clipSourceFrameToDisplay(project, clip, source, marker.source.num / marker.source.den)) }}
					onPointerDown={event => begin(event, 'marker', index + 1)} onKeyDown={event => {
						if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); run(() => controller.actions.audioWarp.deleteSourceMarker(clipId, index + 1)); }
						if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); run(() => controller.actions.audioWarp.moveSourceMarker(clipId, index + 1, clipSourceFrameToDisplay(project, clip, source, marker.source.num / marker.source.den) - range.startFrame + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? Math.round(project.sampleRate / 10) : 1))); }
					}} />)}
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
