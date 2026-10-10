/* SPDX-License-Identifier: AGPL-3.0-only */

/** Retain mouse completion without intercepting the browser's native range thumb. */
export function retainNativeRangeMouseCustody(
	document: Document,
	pointerId: number,
	callbacks: Readonly<{
		finish(): void;
		cancel(): void;
		releasesPrimaryMove?(event: PointerEvent): boolean;
	}>,
): () => void {
	let active = true;
	const owns = (event: PointerEvent): boolean => active && event.pointerId === pointerId && event.pointerType === 'mouse';
	const dispose = (): void => {
		if (!active) return;
		active = false;
		document.removeEventListener('pointermove', move, true);
		document.removeEventListener('pointerup', up, true);
		document.removeEventListener('pointercancel', cancel, true);
	};
	const settle = (canceled: boolean): void => {
		dispose();
		if (canceled) callbacks.cancel(); else callbacks.finish();
	};
	const move = (event: PointerEvent): void => {
		if (owns(event) && (callbacks.releasesPrimaryMove?.(event) ?? ((event.buttons & 1) === 0))) settle(false);
	};
	const up = (event: PointerEvent): void => {
		if (owns(event) && (event.buttons & 1) === 0) settle(false);
	};
	const cancel = (event: PointerEvent): void => { if (owns(event)) settle(true); };
	document.addEventListener('pointermove', move, true);
	document.addEventListener('pointerup', up, true);
	document.addEventListener('pointercancel', cancel, true);
	return dispose;
}
