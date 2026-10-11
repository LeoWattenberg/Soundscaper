/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useRef, useState } from 'react';
import type { ProductVideoGeneratedSourceRuntime } from './product-video-visual-preview-runtime.ts';
/** A single cancellable source-frame request; a replaced revision can never repaint the new view. */
export default function ProductGeneratedSourceCanvas(props: Readonly<{
	runtime: ProductVideoGeneratedSourceRuntime; project: unknown; sourceId: string; sourceFrame: number;
	width: number; height: number; unavailable: string; label: string; onError(): void;
}>) {
	const { runtime, project, sourceId, sourceFrame, width, height, onError } = props;
	const canvas = useRef<HTMLCanvasElement>(null); const [state, setState] = useState<'pending' | 'ready' | 'error'>('pending');
	useEffect(() => {
		const abort = new AbortController(); setState('pending');
		if (canvas.current) { canvas.current.width = width; canvas.current.height = height; }
		void runtime.createFrame({ project, sourceId, sourceFrame, width, height, signal: abort.signal }).then(frame => {
			if (abort.signal.aborted) return;
			if (!frame) throw new Error('Generated source authority is unavailable.');
			const target = canvas.current; if (!target) return;
			const context = target.getContext('2d'); if (!context) throw new Error('Generated source canvas is unavailable.');
			target.width = frame.width; target.height = frame.height;
			context.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0); setState('ready');
		}).catch(() => { if (!abort.signal.aborted) { setState('error'); onError(); } });
		return () => { abort.abort(new DOMException('Generated source view changed.', 'AbortError')); };
	}, [runtime, project, sourceId, sourceFrame, width, height, onError]);
	return <><canvas ref={canvas} data-generated-source-canvas data-generated-source-state={state} aria-label={props.label} />{state === 'error' && <p role="status">{props.unavailable}</p>}</>;
}
