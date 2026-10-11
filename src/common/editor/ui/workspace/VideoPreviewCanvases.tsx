/* SPDX-License-Identifier: AGPL-3.0-only */
import type { RefObject } from 'react';
/** A separate 2D plane also works after an existing WebGL canvas loses its context. */
export default function VideoPreviewCanvases({ gpu, cpu, state }: Readonly<{
	gpu: RefObject<HTMLCanvasElement | null>; cpu: RefObject<HTMLCanvasElement | null>; state: string;
}>) {
	return <>
		<canvas ref={gpu} className="kw-audio-editor__video-preview-canvas" data-video-preview-gpu-canvas data-video-preview-canvas={state === 'cpu' ? undefined : ''} data-renderer-state={state === 'cpu' ? 'fallback' : state} aria-hidden="true" />
		<canvas ref={cpu} className="kw-audio-editor__video-preview-canvas" data-video-preview-cpu-canvas data-video-preview-canvas={state === 'cpu' ? '' : undefined} data-renderer-state={state === 'cpu' ? 'ready' : 'fallback'} aria-hidden="true" />
	</>;
}
