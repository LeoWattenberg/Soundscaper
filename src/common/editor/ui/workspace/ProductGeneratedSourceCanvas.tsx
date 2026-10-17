/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useRef, useState } from 'react';
import { createGeneratedSourcePlayback, type GeneratedSourcePlayback } from '../../controller/composition/product-generated-source-playback.ts';
import type { Rational } from '../../timeline-time.ts';
import type { ProductVideoGeneratedSourceRuntime } from './product-video-visual-preview-runtime.ts';
/** A pinned source lifetime; revision replacement awaits cancelled raster work before the next source starts. */
export default function ProductGeneratedSourceCanvas(props: Readonly<{
	runtime: ProductVideoGeneratedSourceRuntime; project: unknown; sourceId: string; sourceFrame: number;
	frameRate: Rational; sourceFrameCount: number; playing: boolean;
	width: number; height: number; unavailable: string; label: string;
	onError(): void; onPosition(sourceFrame: number): void; onPlayingChanged(playing: boolean): void;
}>) {
	const { runtime, project, sourceId, sourceFrame, width, height, onError, onPosition, onPlayingChanged, playing, sourceFrameCount } = props;
	const rateNum = props.frameRate.num, rateDen = props.frameRate.den;
	const canvas = useRef<HTMLCanvasElement>(null), session = useRef<GeneratedSourcePlayback | null>(null), lifetime = useRef(Promise.resolve());
	const control = useRef({ sourceFrame, playing }); control.current = { sourceFrame, playing };
	const [state, setState] = useState<'pending' | 'ready' | 'error'>('pending');
	useEffect(() => {
		let active = true, created: GeneratedSourcePlayback | null = null;
		setState('pending'); if (canvas.current) { canvas.current.width = width; canvas.current.height = height; }
		const ready = lifetime.current.then(() => {
			if (!active) return;
			created = createGeneratedSourcePlayback({ frameRate: { num: rateNum, den: rateDen }, frameCount: sourceFrameCount,
				async render(ordinal, signal) {
					if (active) setState('pending');
					const frame = await runtime.createFrame({ project, sourceId, sourceFrame: ordinal, width, height, signal });
					if (!frame) throw new Error('Generated source authority is unavailable.'); return frame;
				},
				present(frame, ordinal) {
					if (!active) return; const target = canvas.current; if (!target) return;
					const context = target.getContext('2d'); if (!context) throw new Error('Generated source canvas is unavailable.');
					target.width = frame.width; target.height = frame.height;
					context.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
					setState('ready'); onPosition(ordinal);
				},
				onPlayingChanged(value) { if (active) onPlayingChanged(value); },
				onError() { if (active) { setState('error'); onError(); } },
			});
			session.current = created; applyControl(created, control.current);
		}).catch(() => { if (active) { setState('error'); onError(); } });
		return () => {
			active = false; session.current = null;
			const closing = created?.dispose(); lifetime.current = ready.then(() => closing);
		};
	}, [runtime, project, sourceId, width, height, rateNum, rateDen, sourceFrameCount, onError, onPosition, onPlayingChanged]);
	useEffect(() => { if (session.current) applyControl(session.current, { playing, sourceFrame }); }, [playing, sourceFrame]);
	return <><canvas ref={canvas} data-generated-source-canvas data-generated-source-state={state} aria-label={props.label} />{state === 'error' && <p role="status">{props.unavailable}</p>}</>;
}
function applyControl(session: GeneratedSourcePlayback, control: Readonly<{ playing: boolean; sourceFrame: number }>): void {
	if (control.playing) { if (!session.snapshot().playing) session.play(control.sourceFrame); }
	else session.seek(control.sourceFrame);
}
