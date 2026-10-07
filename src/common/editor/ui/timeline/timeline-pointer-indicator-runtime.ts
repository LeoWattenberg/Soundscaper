/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RefObject } from 'react';
import { createLatestFrameTask } from './animation-frame-coalescer.ts';

interface PointerPosition { readonly pointerType: string; readonly clientX: number; readonly clientY: number; }
interface Options {
	readonly panelRef: RefObject<HTMLElement | null>;
	readonly scrollRef: RefObject<HTMLElement | null>;
	readonly timeIndicatorRef: RefObject<HTMLElement | null>;
	readonly verticalIndicatorRef: RefObject<HTMLElement | null>;
	readonly request: (callback: FrameRequestCallback) => number;
	readonly cancel: (id: number) => void;
}

export function createTimelinePointerIndicatorRuntime(options: Options) {
	const hidden = (element: HTMLElement | null, value: boolean) => { if (element && element.hidden !== value) element.hidden = value; };
	const task = createLatestFrameTask<PointerPosition>(options.request, options.cancel, event => {
		const panel = options.panelRef.current;
		const scroll = options.scrollRef.current;
		const ruler = scroll?.querySelector<HTMLElement>('[data-ruler]');
		if (!panel || !scroll || !ruler) return;
		const rulerRect = ruler.getBoundingClientRect();
		const scrollRect = scroll.getBoundingClientRect();
		const overTime = event.clientX >= rulerRect.left && event.clientX < rulerRect.right
			&& event.clientY >= scrollRect.top && event.clientY < scrollRect.bottom;
		const overTracks = event.clientX >= rulerRect.left && event.clientX < scrollRect.right
			&& event.clientY >= rulerRect.bottom && event.clientY < scrollRect.bottom;
		// Complete reads before any indicator writes, including the panel's origin.
		const panelTop = overTracks ? panel.getBoundingClientRect().top : 0;
		const time = options.timeIndicatorRef.current;
		const vertical = options.verticalIndicatorRef.current;
		hidden(time, !overTime); hidden(vertical, !overTracks);
		if (time && overTime) {
			const transform = `translateX(${event.clientX - rulerRect.left}px)`;
			if (time.style.transform !== transform) time.style.transform = transform;
		}
		if (vertical && overTracks) {
			const top = `${event.clientY - panelTop}px`;
			if (vertical.style.top !== top) vertical.style.top = top;
		}
	});
	const hide = () => { task.flush(true); hidden(options.timeIndicatorRef.current, true); hidden(options.verticalIndicatorRef.current, true); };
	return {
		update(event: PointerPosition) {
			if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') { hide(); return; }
			task.schedule({ pointerType: event.pointerType, clientX: event.clientX, clientY: event.clientY });
		},
		hide,
		dispose() { task.dispose(); },
	};
}
