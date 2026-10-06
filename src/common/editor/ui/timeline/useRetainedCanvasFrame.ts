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
	const attachmentFrame = useRef<number | null>(null);
	const active = useRef(true);
	const release = useCallback(() => {
		if (attachmentFrame.current !== null) window.cancelAnimationFrame(attachmentFrame.current);
		attachmentFrame.current = null;
		ownerRef.current?.observer?.disconnect();
		ownerRef.current?.scheduler.dispose();
		ownerRef.current = null;
	}, []);
	useLayoutEffect(() => {
		active.current = true;
		return () => { active.current = false; release(); drawRef.current = null; };
	}, [release, rootRef]);
	const acquire = useCallback((allowAttachmentRetry = true) => {
		if (!active.current) return;
		const root = rootRef.current;
		if (!root) {
			if (ownerRef.current) release();
			if (allowAttachmentRetry && attachmentFrame.current === null) {
				const frame = window.requestAnimationFrame(() => {
					if (attachmentFrame.current !== frame || !active.current) return;
					attachmentFrame.current = null;
					acquire(false);
				});
				attachmentFrame.current = frame;
			}
			return;
		}
		if (ownerRef.current?.root === root) {
			ownerRef.current.scheduler.schedule();
			return;
		}
		release();
		const scheduler = createAnimationFrameCoalescer(
			callback => window.requestAnimationFrame(callback),
			frame => window.cancelAnimationFrame(frame),
			() => {
				if (rootRef.current !== ownerRef.current?.root) acquire();
				else drawRef.current?.();
			},
		);
		const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduler.schedule) : null;
		ownerRef.current = { root, scheduler, observer };
		observer?.observe(root);
		drawRef.current?.();
	}, [release, rootRef]);
	return useCallback((draw: () => void) => {
		if (!active.current) return;
		drawRef.current = draw;
		acquire();
	}, [acquire]);
}
