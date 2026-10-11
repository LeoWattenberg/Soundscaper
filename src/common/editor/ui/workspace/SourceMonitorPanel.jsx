import { useCallback, useEffect, useRef, useState } from 'react';
import { productVideoVisualPreviewRuntimeFor } from './product-video-visual-preview-runtime.ts';
import ProductGeneratedSourceCanvas from './ProductGeneratedSourceCanvas.tsx';

import '../audio-editor-design-system/23-source-monitor.css';

/**
 * The source monitor: one video source shown on its own frame grid.
 *
 * The controller owns the playhead in source frames; this element's clock only
 * renders it. While the media plays, the clock is read back as the frame it is
 * inside — a conversion, never a second authority — so pausing anywhere leaves
 * the monitor on a frame that can be marked.
 */
export default function SourceMonitorPanel({ controller, snapshot, copy, run, blocked }) {
	const videoRef = useRef(null);
	const [playback, setPlayback] = useState(null);
	const view = controller.actions.video.sourceMonitor.view();
	const playing = playback?.sourceId === view.sourceId && playback?.project === snapshot.project && playback?.openRevision === view.openRevision;
	const visual = view.sourceId ? controller.actions.video.getSourceVisualData(view.sourceId) : null;
	const mediaUrl = visual?.available === false ? null : visual?.mediaUrl || null;
	const generatedRuntime = productVideoVisualPreviewRuntimeFor(controller)?.generatedSources;
	const generated = view.sourceId && generatedRuntime?.ownsSource(snapshot.project, view.sourceId) ? generatedRuntime : null;
	const disabled = blocked || snapshot.readOnly;
	const publishGenerated = useCallback(frame => { controller.actions.video.sourceMonitor.seek(frame); }, [controller]);

	// Playing a source is a viewing action; stopping it is what makes the
	// controller's frame authoritative again.
	const stop = useCallback(() => {
		videoRef.current?.pause?.();
		setPlayback(null);
	}, []);
	const generatedPlayingChanged = useCallback(value => { if (!value) stop(); }, [stop]);
	useEffect(() => { stop(); }, [stop, view.sourceId, view.openRevision, snapshot.project]);
	useEffect(() => {
		const media = videoRef.current;
		if (!media || playing || !Number.isFinite(view.mediaSeconds)) return;
		if (Math.abs((Number(media.currentTime) || 0) - view.mediaSeconds) > 1e-3) {
			try {
				media.currentTime = view.mediaSeconds;
			} catch {
				// Metadata can still be loading; the readiness callback retries.
			}
		}
	}, [playing, view.mediaSeconds, view.sourceId]);

	if (!view.sourceId) {
		return <div className="kw-audio-editor__source-monitor" data-source-monitor="empty">
			<div className="kw-audio-editor__source-monitor-picture"><p className="kw-audio-editor__panel-empty">{copy.sourceMonitorEmpty}</p></div>
		</div>;
	}

	const publish = (frame) => run(() => controller.actions.video.sourceMonitor.seek(frame));
	const capturePlayback = () => {
		if (playing && videoRef.current) {
			controller.actions.video.sourceMonitor.seekMediaTime(Number(videoRef.current.currentTime) || 0);
		}
	};
	const mark = (operation) => run(() => {
		capturePlayback();
		return operation();
	});
	const step = (delta) => {
		run(() => {
			capturePlayback();
			stop();
			return controller.actions.video.sourceMonitor.step(delta);
		});
	};
	const togglePlay = () => {
		if (generated) {
			if (playing) stop(); else setPlayback({ sourceId: view.sourceId, project: snapshot.project, openRevision: view.openRevision });
			return;
		}
		const media = videoRef.current;
		if (!media) return;
		if (playing) {
			stop();
			run(() => controller.actions.video.sourceMonitor.seekMediaTime(Number(media.currentTime) || 0));
			return;
		}
		setPlayback({ sourceId: view.sourceId, project: snapshot.project, openRevision: view.openRevision });
		void media.play?.().catch(() => stop());
	};

	return <div
		className="kw-audio-editor__source-monitor"
		data-source-monitor={view.sourceId}
		data-source-monitor-frame={view.positionFrame}
		data-source-monitor-mark-in={view.markIn == null ? '' : view.markIn}
		data-source-monitor-mark-out={view.markOut == null ? '' : view.markOut}
	>
		<div className="kw-audio-editor__source-monitor-picture">
			{generated ? <ProductGeneratedSourceCanvas runtime={generated} project={snapshot.project} sourceId={view.sourceId} sourceFrame={view.positionFrame}
				width={640} height={360} frameRate={view.frameRate} sourceFrameCount={view.sourceFrameCount} playing={playing} onPosition={publishGenerated} onPlayingChanged={generatedPlayingChanged} unavailable={copy.videoPreviewUnavailable} label={`${copy.panelSourceMonitor}: ${view.sourceName || copy.videoClip}`} onError={stop} /> : mediaUrl
				? <video
					ref={videoRef}
					data-source-monitor-video
					src={mediaUrl}
					muted
					playsInline
					preload="auto"
					aria-label={`${copy.panelSourceMonitor}: ${view.sourceName || copy.videoClip}`}
					onLoadedMetadata={(event) => { event.currentTarget.currentTime = view.mediaSeconds; }}
					onEnded={() => run(() => { capturePlayback(); stop(); })}
				/>
				: <p className="kw-audio-editor__panel-empty" role="status">{copy.videoPreviewUnavailable}</p>}
		</div>
		<p className="kw-audio-editor__source-monitor-readout">
			<output aria-label={copy.sourceMonitorPosition} data-source-monitor-timecode={view.timecodeLabel}>
				{view.timecodeLabel}
			</output>
			<span data-source-monitor-range>
				{view.markIn == null && view.markOut == null
					? copy.sourceMonitorUnmarked
					: `${view.markIn == null ? '—' : String(view.markIn)} · ${view.markOut == null ? '—' : String(view.markOut)}`}
			</span>
		</p>
		<div className="kw-audio-editor__source-monitor-transport">
			<button
				type="button"
				data-source-monitor-action="previous"
				aria-label={copy.previousFrame}
				onClick={() => step(-1)}
			>‹</button>
			<button
				type="button"
				data-source-monitor-action="play"
				aria-label={playing ? copy.pause : copy.play}
				aria-pressed={playing}
				disabled={!mediaUrl && !generated}
				onClick={togglePlay}
			>{playing ? '❚❚' : '▶'}</button>
			<button
				type="button"
				data-source-monitor-action="next"
				aria-label={copy.nextFrame}
				onClick={() => step(1)}
			>›</button>
			<label className="kw-audio-editor__source-monitor-scrub">
				<span className="kw-audio-editor__visually-hidden">{copy.sourceMonitorPosition}</span>
				<input
					type="range"
					min={0}
					max={Math.max(0, view.sourceFrameCount - 1)}
					step={1}
					value={view.positionFrame}
					data-source-monitor-scrub
					onChange={(event) => {
						stop();
						publish(Number(event.currentTarget.value));
					}}
				/>
			</label>
		</div>
		<div className="kw-audio-editor__source-monitor-marks">
			<button
				type="button"
				data-source-monitor-action="mark-in"
				onClick={() => mark(() => controller.actions.video.sourceMonitor.markIn())}
			>{copy.sourceMarkIn}</button>
			<button
				type="button"
				data-source-monitor-action="mark-out"
				onClick={() => mark(() => controller.actions.video.sourceMonitor.markOut())}
			>{copy.sourceMarkOut}</button>
			<button
				type="button"
				data-source-monitor-action="clear-marks"
				disabled={view.markIn == null && view.markOut == null}
				onClick={() => run(() => controller.actions.video.sourceMonitor.clearMarks())}
			>{copy.sourceClearMarks}</button>
		</div>
		<div className="kw-audio-editor__source-monitor-edits">
			<button
				type="button"
				data-source-monitor-action="match-frame"
				onClick={() => run(() => controller.actions.video.matchFrame())}
			>{copy.editMatchFrame}</button>
			<button
				type="button"
				data-source-monitor-action="replace"
				disabled={disabled}
				onClick={() => run(() => controller.actions.video.replace())}
			>{copy.editReplace}</button>
		</div>
	</div>;
}
