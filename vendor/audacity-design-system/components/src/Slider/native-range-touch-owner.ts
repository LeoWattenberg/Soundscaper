/* SPDX-License-Identifier: AGPL-3.0-only */

/** Keep the browser's native range drag with its first admitted finger. */
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
