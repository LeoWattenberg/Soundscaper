/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, type RefObject } from 'react';

export function retainNativeRangeTouchOwner(input: HTMLInputElement): () => void {
	let owner: number | null = null;
	const start = (event: TouchEvent): void => {
		if (owner === null && event.touches.length === 1) {
			owner = event.changedTouches[0]?.identifier ?? null;
			return;
		}
		event.preventDefault();
	};
	const finish = (event: TouchEvent): void => {
		if (owner !== null && Array.from(event.changedTouches).some(touch => touch.identifier === owner)) {
			owner = null;
			return;
		}
		event.preventDefault();
	};
	const options = { capture: true, passive: false };
	input.addEventListener('touchstart', start, options);
	input.addEventListener('touchend', finish, options);
	input.addEventListener('touchcancel', finish, options);
	return () => {
		input.removeEventListener('touchstart', start, options);
		input.removeEventListener('touchend', finish, options);
		input.removeEventListener('touchcancel', finish, options);
	};
}

/** Retain the browser's native range gesture when another finger taps it. */
export function useNativeRangeTouchOwner(): RefObject<HTMLInputElement | null> {
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (input.current) return retainNativeRangeTouchOwner(input.current);
	}, []);
	return input;
}
