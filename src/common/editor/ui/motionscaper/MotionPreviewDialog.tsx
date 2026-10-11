/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { createMotionPreviewClient } from '../../controller/composition/motion-preview-client.ts';
import type { MotionPreviewClient, MotionPreviewState } from '../../controller/composition/motion-preview-types.ts';
import { compareRationals, divideRationals, multiplyRationals, type Rational } from '../../timeline-time.ts';
import { motionCompositionWorkArea } from '../../motion-composition-work-area.ts';
import { formatMotionExactInput as format, parseMotionExactInput as exact } from './motion-exact-input.ts';
import { createMotionMediaProvider } from '../../motion-media-provider.ts';
import { motionCompositionHasAudio } from '../../motion-composition-audio.ts';
import { createMotionAudioMixer } from '../../motion-audio-mixer.ts';
import { createMotionAudioPreview } from '../../controller/track-audio/motion-audio-preview.ts';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
import { loadMotionscaperAssetBytes, type MotionAssetReader } from '../../../../motionscaper/editor-render-resources.ts';

export default function MotionPreviewDialog({ copy, project, store, onClose }: Readonly<{
	copy: Readonly<Record<string, string>>; project: MotionscaperProject; store: MotionAssetReader; onClose: () => void;
}>) {
	const [compositionId, setCompositionId] = useState(project.primaryCompositionId);
	const composition = project.compositions.find((entry) => entry.id === compositionId)!;
	const area = useMemo(() => motionCompositionWorkArea(composition), [composition]);
	const manualFrame = useRef(false); const canvas = useRef<HTMLCanvasElement>(null); const client = useRef<MotionPreviewClient | null>(null);
	const audio = useRef<ReturnType<typeof createMotionAudioPreview> | null>(null); const playback = useRef(0);
	const [buffering, setBuffering] = useState(false);
	const [state, setState] = useState<MotionPreviewState | null>(null);
	const [frame, setFrame] = useState<Rational>(area.startFrame); const [frameText, setFrameText] = useState(format(area.startFrame)); const [error, setError] = useState<string | null>(null); const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		const playbackGeneration = playback;
		let disposed = false; let active: MotionPreviewClient | null = null;
		const loadAsset = (asset: Parameters<typeof loadMotionscaperAssetBytes>[0], signal?: AbortSignal) => loadMotionscaperAssetBytes(asset, store, signal);
		const provider = createMotionMediaProvider({ loadAsset });
		const hasAudio = motionCompositionHasAudio(project, composition.id);
		let mixer: ReturnType<typeof createMotionAudioMixer> | null = null;
		let sound: ReturnType<typeof createMotionAudioPreview> | null = null;
		manualFrame.current = false; setError(null); setState(null); setFrame(area.startFrame); setFrameText(format(area.startFrame)); setBuffering(false);
		void (async () => {
			try {
				mixer = hasAudio ? createMotionAudioMixer({ project, provider }) : null;
				sound = mixer ? createMotionAudioPreview({ mixer, onError: (failure) => {
					active?.pause(); if (!disposed) { setBuffering(false); setError(failure.message); }
				} }) : null;
				audio.current = sound;
				active = await createMotionPreviewClient({
					...(sound ? { clock: sound.clock } : {}),
					onState: (next) => { if (!disposed) { setState(next); if (next.status === 'error') sound?.pause(); } },
					onError: (failure) => { if (!disposed) setError(failure.message); },
					onFrame: (next) => {
						if (disposed || !canvas.current) return;
						const context = canvas.current.getContext('2d');
						if (!context) throw new Error(copy.motionscaperPreviewFailed);
						canvas.current.width = next.width; canvas.current.height = next.height;
						context.putImageData(new ImageData(new Uint8ClampedArray(next.rgba), next.width, next.height), 0, 0);
						canvas.current.dataset.motionRendered = String(next.revision);
						const currentFrame = multiplyRationals(next.time, composition.frameRate);
						canvas.current.dataset.motionFrame = format(currentFrame);
						setFrame(currentFrame); if (!manualFrame.current) setFrameText(format(currentFrame));
					},
				});
				if (disposed) { active.dispose(); return; }
				client.current = active;
				await active.setProject(project, loadAsset, provider.decodeFootage);
				if (!disposed) await active.seek({ compositionId: composition.id, time: divideRationals(area.startFrame, composition.frameRate) });
			} catch (failure) { if (!disposed) setError(failure instanceof Error ? failure.message : copy.motionscaperPreviewFailed!); }
		})();
		return () => { disposed = true; playbackGeneration.current++; active?.dispose(); sound?.dispose(); mixer?.dispose(); provider.dispose(); client.current = null; audio.current = null; };
	}, [project, composition, area, copy, store, attempt]);
	const ready = state && state.status !== 'idle' && state.status !== 'loading' && state.status !== 'error';
	const playing = state?.status === 'playing' || buffering;
	let validFrame = false;
	try { const value = exact(frameText); validFrame = value.num >= 0 && compareRationals(value, composition.durationFrames) < 0; } catch { /* Keep an incomplete fractional draft editable. */ }
	const seek = (text: string) => {
		manualFrame.current = true; setFrameText(text); let value: Rational;
		try { value = exact(text); } catch { return; }
		if (!client.current || value.num < 0 || compareRationals(value, composition.durationFrames) >= 0) return;
		playback.current++; audio.current?.pause(); setBuffering(false); setFrame(value); setError(null);
		void client.current.seek({ compositionId: composition.id, time: divideRationals(value, composition.frameRate) })
			.catch((failure: unknown) => { setError(failure instanceof Error ? failure.message : copy.motionscaperPreviewFailed!); });
	};
	const play = async () => {
		const generation = ++playback.current;
		try {
			if (playing) { audio.current?.pause(); client.current?.pause(); setBuffering(false); }
			else {
				manualFrame.current = false;
				const range = { compositionId: composition.id, startTime: divideRationals(compareRationals(frame, area.startFrame) < 0 || compareRationals(frame, area.endFrame) >= 0 ? area.startFrame : frame, composition.frameRate),
					endTime: divideRationals(area.endFrame, composition.frameRate) };
				setBuffering(true); setError(null); await audio.current?.play(range);
				if (generation === playback.current) { client.current?.play(range); setBuffering(false); }
			}
		} catch (failure) { if (generation === playback.current) { setBuffering(false); setError(failure instanceof Error ? failure.message : copy.motionscaperPreviewFailed!); } }
	};
	return <AudioEditorDialogShell title={copy.motionscaperPreview} onClose={onClose} width={840} initialFocus="[data-motion-preview-frame]"
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<Button variant="secondary" onClick={onClose}>{copy.motionscaperClose}</Button>} />}>
		<label>{copy.motionscaperComposition}<select value={composition.id} onChange={(event) => { playback.current++; audio.current?.pause(); client.current?.pause(); setCompositionId(event.currentTarget.value); }}>{project.compositions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
		<p>{copy.motionscaperWorkArea}: {format(area.startFrame)}–{format(area.endFrame)}</p>
		<canvas ref={canvas} className="motionscaper-preview-canvas" aria-label={composition.name} width={1} height={1} />
		<div className="motionscaper-preview-controls">
			<label>{copy.motionscaperFrame}<input data-motion-preview-frame
				value={frameText} aria-invalid={!validFrame} disabled={!ready} onChange={(event) => seek(event.currentTarget.value)} /></label>
			<Button variant="secondary" disabled={!ready || (!playing && !validFrame)} onClick={() => { void play(); }}>{playing ? copy.motionscaperPause : copy.motionscaperPlay}</Button>
		</div>
		{!validFrame && <p role="alert">{copy.motionscaperPreviewFrameInvalid}</p>}
		{error ? <><p role="alert">{copy.motionscaperPreviewFailed} {error}</p>
			<Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>{copy.motionscaperRetry}</Button></>
			: <p role="status">{state?.status === 'paused' ? copy.motionscaperPreviewReady : copy.motionscaperWorking}</p>}
	</AudioEditorDialogShell>;
}
