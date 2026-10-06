/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef, type RefObject } from 'react';

/** Source marker keys follow their native source sample through warp publication. */
export function useClipSourceMarkerDeletion(
	waveRef: RefObject<HTMLDivElement | null>,
	warpMap: unknown,
) {
	const pendingRef = useRef<Readonly<{ current: HTMLButtonElement; nextSample: string | null }> | null>(null);
	useLayoutEffect(() => {
		const pending = pendingRef.current;
		pendingRef.current = null;
		const wave = waveRef.current;
		if (!pending || !wave?.isConnected || pending.current.isConnected) return;
		const next = Array.from(wave.querySelectorAll<HTMLButtonElement>('[data-source-sample]'))
			.find(marker => marker.getAttribute('data-source-sample') === pending.nextSample);
		(next ?? wave).focus({ preventScroll: true });
	}, [warpMap, waveRef]);
	return (current: HTMLButtonElement, remove: () => void): void => {
		const markers = Array.from(waveRef.current?.querySelectorAll<HTMLButtonElement>('[data-source-sample]') ?? []);
		const index = markers.indexOf(current);
		pendingRef.current = {
			current, nextSample: (markers[index + 1] ?? markers[index - 1])?.getAttribute('data-source-sample') ?? null,
		};
		try { remove(); } catch (error) { pendingRef.current = null; throw error; }
	};
}
