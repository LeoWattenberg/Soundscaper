/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import { createAnimationFrameCoalescer, type AnimationFrameCoalescer } from './animation-frame-coalescer.ts';

interface CanvasFrameOwner {
	root: HTMLElement;
	scheduler: AnimationFrameCoalescer;
	observer: ResizeObserver | null;
}

/** A child may mount before its parent's host ref is attached. Acquire lazily. */
export function useRetainedCanvasFrame(rootRef: RefObject<HTMLElement | null>) {
	const ownerRef = useRef<CanvasFrameOwner | null>(null);
	const drawRef = useRef<(() => void) | null>(null);
	const release = useCallback(() => {
		ownerRef.current?.observer?.disconnect();
		ownerRef.current?.scheduler.dispose();
		ownerRef.current = null;
	}, []);
	useLayoutEffect(() => release, [release]);
	return useCallback((draw: () => void) => {
		drawRef.current = draw;
		const root = rootRef.current;
		if (!root) { release(); return; }
		if (ownerRef.current?.root === root) {
			ownerRef.current.scheduler.schedule();
			return;
		}
		release();
		const scheduler = createAnimationFrameCoalescer(
			callback => window.requestAnimationFrame(callback),
			frame => window.cancelAnimationFrame(frame),
			() => drawRef.current?.(),
		);
		const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduler.schedule) : null;
		ownerRef.current = { root, scheduler, observer };
		observer?.observe(root);
		draw();
	}, [release, rootRef]);
}
