/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { createMotionPreviewClient } from '../../controller/composition/motion-preview-client.ts';
import type { MotionPreviewClient, MotionPreviewState } from '../../controller/composition/motion-preview-types.ts';
import { divideRationals } from '../../timeline-time.ts';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
import { loadMotionscaperAssetBytes, type MotionAssetReader } from '../../../../motionscaper/editor-render-resources.ts';

export default function MotionPreviewDialog({ copy, project, store, onClose }: Readonly<{
	copy: Readonly<Record<string, string>>; project: MotionscaperProject; store: MotionAssetReader; onClose: () => void;
}>) {
	const composition = project.compositions.find((entry) => entry.id === project.primaryCompositionId)!;
	const canvas = useRef<HTMLCanvasElement>(null); const client = useRef<MotionPreviewClient | null>(null);
	const [state, setState] = useState<MotionPreviewState | null>(null);
	const [frame, setFrame] = useState(0); const [error, setError] = useState<string | null>(null); const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		let disposed = false; let active: MotionPreviewClient | null = null;
		setError(null); setState(null);
		void (async () => {
			try {
				active = await createMotionPreviewClient({
					onState: (next) => { if (!disposed) setState(next); },
					onError: (failure) => { if (!disposed) setError(failure.message); },
					onFrame: (next) => {
						if (disposed || !canvas.current) return;
						const context = canvas.current.getContext('2d');
						if (!context) throw new Error(copy.motionscaperPreviewFailed);
						canvas.current.width = next.width; canvas.current.height = next.height;
						context.putImageData(new ImageData(new Uint8ClampedArray(next.rgba), next.width, next.height), 0, 0);
						canvas.current.dataset.motionRendered = String(next.revision);
						canvas.current.dataset.motionFrame = String(Math.round(next.time.num * composition.frameRate.num / (next.time.den * composition.frameRate.den)));
						setFrame(Math.round(next.time.num * composition.frameRate.num / (next.time.den * composition.frameRate.den)));
					},
				});
				if (disposed) { active.dispose(); return; }
				client.current = active;
				await active.setProject(project, (asset, signal) => loadMotionscaperAssetBytes(asset, store, signal));
				if (!disposed) await active.seek({ compositionId: composition.id, time: 0 });
			} catch (failure) { if (!disposed) setError(failure instanceof Error ? failure.message : copy.motionscaperPreviewFailed!); }
		})();
		return () => { disposed = true; active?.dispose(); client.current = null; };
	}, [project, composition, copy, store, attempt]);
	const ready = state && state.status !== 'idle' && state.status !== 'loading' && state.status !== 'error';
	const playing = state?.status === 'playing';
	const seek = (value: number) => {
		if (!client.current || !Number.isSafeInteger(value) || value < 0 || value >= composition.durationFrames) return;
		setFrame(value); setError(null);
		void client.current.seek({ compositionId: composition.id, time: divideRationals(value, composition.frameRate) })
			.catch((failure: unknown) => { setError(failure instanceof Error ? failure.message : copy.motionscaperPreviewFailed!); });
	};
	const play = () => {
		try {
			if (playing) client.current?.pause();
			else client.current?.play({ compositionId: composition.id, startTime: divideRationals(frame >= composition.durationFrames - 1 ? 0 : frame, composition.frameRate),
				endTime: divideRationals(composition.durationFrames, composition.frameRate) });
		} catch (failure) { setError(failure instanceof Error ? failure.message : copy.motionscaperPreviewFailed!); }
	};
	return <AudioEditorDialogShell title={copy.motionscaperPreview} onClose={onClose} width={840} initialFocus="[data-motion-preview-frame]"
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<Button variant="secondary" onClick={onClose}>{copy.motionscaperClose}</Button>} />}>
		<canvas ref={canvas} className="motionscaper-preview-canvas" aria-label={composition.name} width={1} height={1} />
		<div className="motionscaper-preview-controls">
			<label>{copy.motionscaperFrame}<input data-motion-preview-frame type="number" min={0} max={composition.durationFrames - 1} step={1}
				value={frame} disabled={!ready} onChange={(event) => seek(event.currentTarget.valueAsNumber)} /></label>
			<Button variant="secondary" disabled={!ready} onClick={play}>{playing ? copy.motionscaperPause : copy.motionscaperPlay}</Button>
		</div>
		{error ? <><p role="alert">{copy.motionscaperPreviewFailed} {error}</p>
			<Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>{copy.motionscaperRetry}</Button></>
			: <p role="status">{state?.status === 'paused' ? copy.motionscaperPreviewReady : copy.motionscaperWorking}</p>}
	</AudioEditorDialogShell>;
}
