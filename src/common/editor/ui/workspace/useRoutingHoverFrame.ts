/* SPDX-License-Identifier: AGPL-3.0-only */
import { useCallback, useEffect, useRef } from 'react';

interface HoverSample { readonly target: HTMLElement; readonly x: number; readonly y: number }
export function useRoutingHoverFrame(enabled: boolean, zoom: number, publish: (point: Readonly<{ x: number; y: number }>) => void) {
	const pending = useRef<{ frame: number; sample: HoverSample } | null>(null);
	const cancel = useCallback(() => { if (pending.current) cancelAnimationFrame(pending.current.frame); pending.current = null; }, []);
	useEffect(() => cancel, [cancel, enabled, zoom]);
	const schedule = useCallback((sample: HoverSample) => {
		if (!enabled) return;
		if (pending.current) { pending.current.sample = sample; return; }
		const frame = requestAnimationFrame(() => {
			const next = pending.current; pending.current = null;
			if (!next) return;
			const { target, x, y } = next.sample;
			const bounds = target.getBoundingClientRect();
			publish({ x: (x - bounds.left + target.scrollLeft) / zoom, y: (y - bounds.top + target.scrollTop) / zoom });
		});
		pending.current = { frame, sample };
	}, [enabled, publish, zoom]);
	return { schedule, cancel };
}
